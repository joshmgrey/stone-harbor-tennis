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

# One field of the task, retrying transient API errors (throttling, network
# blips) so a single failed poll can't abort the wait mid-migration. Prints
# the value; returns non-zero only after every attempt failed.
#
# stderr is kept separate: a warning the CLI prints on a successful call
# must not end up in the value (e.g. a status that never equals STOPPED).
task_field() {
  local attempt out errf
  errf=$(mktemp)
  for attempt in 1 2 3 4 5; do
    if out=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$arn" \
        --query "tasks[0].$1" --output text 2>"$errf"); then
      rm -f "$errf"
      echo "$out"
      return 0
    fi
    echo "describe-tasks failed (attempt $attempt/5): $(cat "$errf")" >&2
    (( attempt < 5 )) && sleep $(( attempt * 5 ))
  done
  rm -f "$errf"
  return 1
}

# Fail the run without touching the task, and show what it logged.
give_up() {
  echo "::error::$1 Task: $arn"
  show_logs
  exit 1
}
still_running="It was NOT stopped (a migration may be mid-flight); check it in the ECS console before re-running."

# Poll instead of `aws ecs wait tasks-stopped`, which gives up after ~10 min
# (100 x 6s). Long migrations or slow image pulls get MIGRATOR_TIMEOUT_SECONDS
# (default 30 min).
timeout=${MIGRATOR_TIMEOUT_SECONDS:-1800}
while :; do
  status=$(task_field lastStatus) || give_up "Couldn't read the migrator task's status. $still_running"
  [ "$status" = "STOPPED" ] && break
  # describe-tasks succeeds but returns no task (reported under `failures`
  # as MISSING). The ECS API is eventually consistent, so a task that was
  # just started can briefly look missing: only give up after a grace
  # period, not on the first poll.
  if [ "$status" = "None" ] || [ -z "$status" ]; then
    if (( $(date +%s) - started >= ${MIGRATOR_MISSING_GRACE_SECONDS:-60} )); then
      give_up "ECS still doesn't know the migrator task (not found). $still_running"
    fi
    echo "task not visible yet; waiting" >&2
  fi
  if (( $(date +%s) - started >= timeout )); then
    give_up "Migrator task still $status after ${timeout}s. $still_running"
  fi
  sleep 10
done

lookup_failed="Couldn't read the stopped migrator task's result."
code=$(task_field 'containers[0].exitCode') || give_up "$lookup_failed"
reason=$(task_field 'containers[0].reason') || give_up "$lookup_failed"
# Set when the container never started (image pull, secrets, capacity) —
# then there's no exit code and the cause is only here.
stop_code=$(task_field stopCode) || give_up "$lookup_failed"
stopped_reason=$(task_field stoppedReason) || give_up "$lookup_failed"
echo "exit code: $code  container reason: $reason"
echo "stop code: $stop_code  stopped reason: $stopped_reason"

if [ "$code" != "0" ]; then
  echo "::error::migration task failed (exit code: $code; stopped: $stopped_reason)"
  show_logs
  exit 1
fi
