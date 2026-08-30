#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DatabaseStack } from "../lib/database-stack";
import { GitHubDeployStack } from "../lib/github-deploy-stack";
import { AppStack } from "../lib/app-stack";

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

// Only in the tree when its context is present — a CI `cdk deploy AppStack`
// runs this same file and would otherwise throw on these `req()` calls
// (`cdk.context.json` is gitignored, so CI has no db:* values). DatabaseStack
// is only ever deployed from a laptop, where the context file exists.
if (opt("db:instanceIdentifier")) {
  new DatabaseStack(app, "DatabaseStack", {
    env,
    description:
      "Path A: adopts the manually-provisioned Stone Harbor tennis RDS instance",

    // Use the CLI's own credentials for every CloudFormation call instead of
    // the bootstrap deploy/exec roles. The DefaultStackSynthesizer passes a
    // `RoleARN` on the change set, which CloudFormation rejects for IMPORT
    // operations ("you cannot modify or add [RoleArn, Tags]"). This stack has
    // no file/Docker assets, so it needs nothing from the bootstrap stack.
    synthesizer: new cdk.CliCredentialsStackSynthesizer(),

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
  });
}

// NOTE: no stack tags on DatabaseStack. `cdk import` fails with "you cannot
// modify or add [RoleArn, Tags]" if the IMPORT change set carries stack-level
// tags. Add tags in a follow-up `cdk deploy` after the import is clean:
//   cdk.Tags.of(app).add("project", "stone-harbor-tennis");

// Path B / B0 — OIDC role for `cdk deploy` from GitHub Actions.
// Deploy once from your laptop after `cdk bootstrap`.
new GitHubDeployStack(app, "GitHubDeployStack", {
  env,
  description: "OIDC provider + role for cdk deploy from GitHub Actions",
  ownerRepo: opt("github:ownerRepo") ?? "joshmgrey/stone-harbor-tennis",
  subjectClaims: opt("github:subjectClaim")
    ? [opt("github:subjectClaim")!]
    : undefined,
  existingOidcProviderArn: opt("github:oidcProviderArn"),
});

// Path B / B2 — the app on Fargate. Guarded on the secret ARN (the last
// thing configured): it builds a Docker image asset, so until you're ready
// the other stacks stay usable on a machine without Docker. CI passes every
// `app:*` value and gets the stack.
if (opt("app:databaseUrlSecretArn")) {
  new AppStack(app, "AppStack", {
    env,
    description: "Path B: Next.js app on ECS Fargate + ALB in the default VPC",
    // Its own key (not db:vpcId) so a CI deploy of AppStack needs no db:*
    // context at all.
    vpcId: req("app:vpcId"),
    hostedZoneId: req("app:hostedZoneId"),
    zoneName: req("app:zoneName"),
    googleMapsApiKey: opt("app:googleMapsApiKey") ?? "",
    databaseUrlSecretArn: req("app:databaseUrlSecretArn"),
    authSecretArn: req("app:authSecretArn"),
  });
}
