#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DatabaseStack } from "../lib/database-stack";

const app = new cdk.App();

/**
 * Every DatabaseStack prop must byte-for-byte match the live instance for
 * `cdk import` to be a no-op, so nothing here has a default. Values come from
 * `cdk.context.json` (gitignored — this repo is public) or `-c key=value` on
 * the CLI. Read them off the live instance first:
 *
 *   aws rds describe-db-instances --db-instance-identifier <ID> \
 *     --query 'DBInstances[0].{engine:EngineVersion,storage:AllocatedStorage,
 *       maxStorage:MaxAllocatedStorage,storageType:StorageType,
 *       subnetGroup:DBSubnetGroup.DBSubnetGroupName,vpc:DBSubnetGroup.VpcId,
 *       sgs:VpcSecurityGroups[].VpcSecurityGroupId,masterUser:MasterUsername,
 *       dbName:DBName,class:DBInstanceClass,encrypted:StorageEncrypted,
 *       kmsKey:KmsKeyId,multiAz:MultiAZ}'
 */
function req(key: string): string {
  const value = app.node.tryGetContext(key);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Missing required context "${key}". Add it to infra/cdk.context.json ` +
        `(gitignored), or pass -c ${key}=<value> on the command line.`,
    );
  }
  return value;
}

/** Optional context — returns undefined if unset or empty. */
function opt(key: string): string | undefined {
  const value = app.node.tryGetContext(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// The CDK CLI populates these from your active AWS credentials/profile.
// A concrete account + region is mandatory because DatabaseStack uses
// Vpc.fromLookup (an environment-agnostic stack cannot do lookups).
const env: cdk.Environment = {
  account:
    app.node.tryGetContext("env:account") ?? process.env.CDK_DEFAULT_ACCOUNT,
  region:
    app.node.tryGetContext("env:region") ?? process.env.CDK_DEFAULT_REGION,
};

if (!env.account || !env.region) {
  throw new Error(
    "Could not resolve AWS account/region. Run with credentials configured " +
      "(aws sso login / AWS_PROFILE), or set -c env:account=... -c env:region=...",
  );
}

new DatabaseStack(app, "DatabaseStack", {
  env,
  description:
    "Path A: adopts the manually-provisioned Stone Harbor tennis RDS instance",

  dbInstanceIdentifier: req("db:instanceIdentifier"),
  engineVersion: req("db:engineVersion"),
  allocatedStorageGib: Number(req("db:allocatedStorageGib")),
  vpcId: req("db:vpcId"),
  dbSubnetGroupName: req("db:subnetGroupName"),
  dbSecurityGroupId: req("db:securityGroupId"),
  masterUsername: req("db:masterUsername"),
  masterCredentialsSecretArn: req("db:masterSecretArn"),

  // Optional: set ONLY if `describe-db-instances` shows a non-null DBName.
  // Create-only — a wrong value here replaces the instance on deploy.
  databaseName: opt("db:databaseName"),

  // Optional: the KMS key ARN the encrypted instance uses. Omit to let
  // CloudFormation resolve the default aws/rds key; set it if `cdk diff`
  // after import shows a KmsKeyId change.
  kmsKeyArn: opt("db:kmsKeyArn"),

  tags: {
    project: "stone-harbor-tennis",
    managedBy: "cdk",
  },
});
