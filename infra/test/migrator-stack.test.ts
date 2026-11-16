import * as fs from "fs";
import * as path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { MigratorStack, type MigratorStackProps } from "../lib/migrator-stack";

const ENV = { account: "123456789012", region: "us-east-2" };

const BASE: Omit<MigratorStackProps, "env"> = {
  dbMasterSecretArn:
    "arn:aws:secretsmanager:us-east-2:123456789012:secret:stone-harbor-tennis/rds/master-AbCdEf",
  appDatabaseUrlSecretArn:
    "arn:aws:secretsmanager:us-east-2:123456789012:secret:stone-harbor-tennis/app/app-database-url-AbCdEf",
};

let template: Template;
let assemblyDir: string;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new MigratorStack(app, "MigratorStack", { env: ENV, ...BASE });
  template = Template.fromStack(stack);
  assemblyDir = app.synth().directory;
});

describe("MigratorStack", () => {
  it("defines one Fargate task that migrates, then syncs the app role", () => {
    template.resourceCountIs("AWS::ECS::TaskDefinition", 1);
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "256",
      Memory: "512",
      RequiresCompatibilities: ["FARGATE"],
      ContainerDefinitions: [
        Match.objectLike({
          Name: "migrate",
          Command: ["node", "scripts/migrate.mjs"],
          Environment: [{ Name: "NODE_ENV", Value: "production" }],
        }),
      ],
    });
  });

  it("gives the migrator the master secret and the app database URL", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: [
        Match.objectLike({
          Secrets: [
            { Name: "DB_MASTER_SECRET", ValueFrom: BASE.dbMasterSecretArn },
            { Name: "APP_DATABASE_URL", ValueFrom: BASE.appDatabaseUrlSecretArn },
          ],
        }),
      ],
    });
  });

  it("creates no service or load balancer: it only runs on demand", () => {
    template.resourceCountIs("AWS::ECS::Service", 0);
    template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
    template.resourceCountIs("AWS::ECS::Cluster", 0);
  });

  it("keeps migrator logs for one month in its own group", () => {
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { RetentionInDays: 30 },
      DeletionPolicy: "Delete",
    });
  });

  it("exports what run-migrator.sh reads back via describe-stacks", () => {
    for (const key of ["MigratorTaskDefinitionArn", "MigratorLogGroupName"]) {
      template.hasOutput(key, Match.anyValue());
    }
  });

  it("builds the migrator from the Dockerfile's migrator target (has the prisma CLI)", () => {
    // The build target isn't in the template; it's in the asset manifest the
    // CLI uses to build and publish the image.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(assemblyDir, "MigratorStack.assets.json"), "utf8"),
    );
    const images = Object.values(manifest.dockerImages ?? {}) as {
      source: { dockerFile?: string; dockerBuildTarget?: string; platform?: string };
    }[];
    expect(images).toHaveLength(1);
    expect(images[0].source).toMatchObject({
      dockerFile: "Dockerfile",
      dockerBuildTarget: "migrator",
      platform: "linux/amd64",
    });
  });
});
