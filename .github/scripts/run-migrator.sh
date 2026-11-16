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

aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$arn"

read -r code reason < <(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$arn" \
  --query 'tasks[0].containers[0].[exitCode,reason]' --output text)
echo "exit code: $code  reason: $reason"

if [ "$code" != "0" ]; then
  echo "::error::migration task failed"
  aws logs tail "$LOG_GROUP" --since 15m --format short || true
  exit 1
fi
