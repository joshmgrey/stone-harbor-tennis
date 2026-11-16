#!/usr/bin/env bash
# Run the migrator (`prisma migrate deploy` + app-role sync) as a one-off
# Fargate task and fail if it does. Used by deploy.yml (after deploying
# MigratorStack, BEFORE rolling AppStack) and by migrate.yml (manual runs).
#
# The task definition comes from MigratorStack; the cluster, subnets and
# security group (the service's, which RDS lets in) come from AppStack.
set -euo pipefail

outputs() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query 'Stacks[0].Outputs' --output json
}
get() { echo "$1" | jq -r --arg k "$2" '.[]|select(.OutputKey==$k).OutputValue'; }

app=$(outputs AppStack)
migrator=$(outputs MigratorStack)

CLUSTER=$(get "$app" ClusterName)
SUBNETS=$(get "$app" TaskSubnetIds)
SG=$(get "$app" ServiceSecurityGroupId)
TASKDEF=$(get "$migrator" MigratorTaskDefinitionArn)
LOG_GROUP=$(get "$migrator" MigratorLogGroupName)

for v in CLUSTER SUBNETS SG TASKDEF LOG_GROUP; do
  if [ -z "${!v}" ] || [ "${!v}" = "null" ]; then
    echo "::error::missing stack output for $v"
    exit 1
  fi
done

echo "cluster=$CLUSTER  taskdef=$TASKDEF"

arn=$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$TASKDEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --started-by "gha-migrate" \
  --query 'tasks[0].taskArn' --output text)

if [ -z "$arn" ] || [ "$arn" = "None" ]; then
  echo "::error::ecs run-task did not start the migrator task"
  exit 1
fi
echo "task: $arn"
started=$(date +%s)

# Migrator log lines since the task started (plus a margin), for failures.
show_logs() {
  local mins=$(( ($(date +%s) - started) / 60 + 2 ))
  aws logs tail "$LOG_GROUP" --since "${mins}m" --format short || true
}

task_field() {
  aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$arn" \
    --query "tasks[0].$1" --output text
}

# Poll instead of `aws ecs wait tasks-stopped`, which gives up after ~10 min
# (100 x 6s). Long migrations or slow image pulls get MIGRATOR_TIMEOUT_SECONDS
# (default 30 min).
timeout=${MIGRATOR_TIMEOUT_SECONDS:-1800}
while :; do
  status=$(task_field lastStatus)
  [ "$status" = "STOPPED" ] && break
  if (( $(date +%s) - started >= timeout )); then
    echo "::error::migrator task still $status after ${timeout}s; it was NOT stopped (a migration may be mid-flight). Check it in the ECS console before re-running: $arn"
    show_logs
    exit 1
  fi
  sleep 10
done

code=$(task_field 'containers[0].exitCode')
reason=$(task_field 'containers[0].reason')
# Set when the container never started (image pull, secrets, capacity) —
# then there's no exit code and the cause is only here.
stop_code=$(task_field stopCode)
stopped_reason=$(task_field stoppedReason)
echo "exit code: $code  container reason: $reason"
echo "stop code: $stop_code  stopped reason: $stopped_reason"

if [ "$code" != "0" ]; then
  echo "::error::migration task failed (exit code: $code; stopped: $stopped_reason)"
  show_logs
  exit 1
fi
