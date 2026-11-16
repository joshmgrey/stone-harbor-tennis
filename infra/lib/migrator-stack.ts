import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";

export interface MigratorStackProps extends cdk.StackProps {
  /**
   * The RDS master secret (`stone-harbor-tennis/rds/master`). Only this task
   * reads it: scripts/migrate.mjs derives the owner URL from it.
   */
  readonly dbMasterSecretArn: string;

  /**
   * The app role's connection string. The migrator creates/refreshes that
   * role from it after every `migrate deploy` (scripts/sync-app-db-role.mjs).
   */
  readonly appDatabaseUrlSecretArn: string;
}

/**
 * The migrator: `prisma migrate deploy` + app-role sync as a one-off Fargate
 * task, in its own stack so a deploy can update and run it BEFORE AppStack
 * rolls the service onto new code:
 *
 *   deploy.yml: cdk deploy MigratorStack -> run migrator -> cdk deploy AppStack
 *
 * (In AppStack, the migrator's new image and the service's new image went out
 * in the same `cdk deploy`, so the new app could serve before its migration
 * ran.) It runs in AppStack's cluster with the service's security group (so
 * RDS lets it in); those come from AppStack's outputs at run time, which keeps
 * this stack free of cross-stack references.
 *
 * The master secret stays out of the service: only this task definition
 * references it.
 */
export class MigratorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MigratorStackProps) {
    super(scope, id, props);

    const dbMaster = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "DbMasterSecret",
      props.dbMasterSecretArn,
    );
    const appDatabaseUrl = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "AppDatabaseUrlSecret",
      props.appDatabaseUrlSecretArn,
    );

    const logGroup = new logs.LogGroup(this, "Logs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const task = new ecs.FargateTaskDefinition(this, "MigratorTask", {
      cpu: 256,
      memoryLimitMiB: 512,
    });
    task.addContainer("migrate", {
      // The `migrator` build target keeps the full toolchain (prisma CLI).
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, "..", ".."), {
        file: "Dockerfile",
        target: "migrator",
        platform: ecrAssets.Platform.LINUX_AMD64,
      }),
      // Migrate as the owner (URL derived from the master secret JSON),
      // then bring the app role in line with APP_DATABASE_URL.
      command: ["node", "scripts/migrate.mjs"],
      environment: { NODE_ENV: "production" },
      secrets: {
        DB_MASTER_SECRET: ecs.Secret.fromSecretsManager(dbMaster),
        APP_DATABASE_URL: ecs.Secret.fromSecretsManager(appDatabaseUrl),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "migrate", logGroup }),
    });

    // Read back by .github/scripts/run-migrator.sh via `describe-stacks`.
    new cdk.CfnOutput(this, "MigratorTaskDefinitionArn", {
      value: task.taskDefinitionArn,
    });
    new cdk.CfnOutput(this, "MigratorLogGroupName", {
      value: logGroup.logGroupName,
    });
  }
}
