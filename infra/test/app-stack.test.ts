import { beforeAll, describe, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AppStack, type AppStackProps } from "../lib/app-stack";

const ENV = { account: "123456789012", region: "us-east-2" };

const BASE: Omit<AppStackProps, "env"> = {
  vpcId: "vpc-12345678",
  hostedZoneId: "Z0123456789ABCDEFGHIJ",
  zoneName: "stoneharbortennis.com",
  googleMapsApiKey: "",
  databaseUrlSecretArn:
    "arn:aws:secretsmanager:us-east-2:123456789012:secret:stone-harbor-tennis/app/database-url-AbCdEf",
  authSecretArn:
    "arn:aws:secretsmanager:us-east-2:123456789012:secret:stone-harbor-tennis/app/auth-secret-AbCdEf",
};

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new AppStack(app, "AppStack", { env: ENV, ...BASE });
  template = Template.fromStack(stack);
});

describe("AppStack", () => {
  it("runs a single Fargate task with a safe rolling deploy", () => {
    template.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: 1,
      LaunchType: "FARGATE",
      DeploymentConfiguration: Match.objectLike({
        MinimumHealthyPercent: 100,
        MaximumPercent: 200,
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  it("sizes the service task at 256 CPU / 512 MiB", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "256",
      Memory: "512",
      RequiresCompatibilities: ["FARGATE"],
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          PortMappings: Match.arrayWith([Match.objectLike({ ContainerPort: 3000 })]),
          Environment: Match.arrayWith([
            { Name: "NODE_ENV", Value: "production" },
          ]),
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: "DATABASE_URL" }),
            Match.objectLike({ Name: "AUTH_SECRET" }),
          ]),
        }),
      ]),
    });
  });

  it("defines a separate migrator task that runs `prisma migrate deploy`", () => {
    template.resourceCountIs("AWS::ECS::TaskDefinition", 2);
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: "migrate",
          Command: ["npx", "prisma", "migrate", "deploy"],
          Secrets: Match.arrayWith([Match.objectLike({ Name: "DATABASE_URL" })]),
        }),
      ]),
    });
  });

  it("puts the app behind an internet-facing ALB on HTTPS with an HTTP redirect", () => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      Scheme: "internet-facing",
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 443,
      Protocol: "HTTPS",
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 80,
      Protocol: "HTTP",
      DefaultActions: Match.arrayWith([
        Match.objectLike({
          Type: "redirect",
          RedirectConfig: Match.objectLike({ Protocol: "HTTPS", StatusCode: "HTTP_301" }),
        }),
      ]),
    });
  });

  it("health-checks the target group at /api/health", () => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      HealthCheckPath: "/api/health",
      Matcher: { HttpCode: "200" },
    });
  });

  it("issues one ACM cert covering the apex, www, and staging hosts", () => {
    template.resourceCountIs("AWS::CertificateManager::Certificate", 1);
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "stoneharbortennis.com",
      SubjectAlternativeNames: Match.arrayWith([
        "www.stoneharbortennis.com",
        "new.stoneharbortennis.com",
      ]),
    });
  });

  it("points the apex at the ALB with an alias A record and www with a CNAME", () => {
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      Name: "stoneharbortennis.com.",
      AliasTarget: Match.anyValue(),
    });
    template.hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "CNAME",
      Name: "www.stoneharbortennis.com.",
    });
  });

  it("keeps container logs for one month and tears the group down with the stack", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 30,
    });
    template.hasResource("AWS::Logs::LogGroup", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("exports what the migrate workflow reads back via describe-stacks", () => {
    for (const key of [
      "ClusterName",
      "MigratorTaskDefinitionArn",
      "TaskSubnetIds",
      "ServiceSecurityGroupId",
    ]) {
      template.hasOutput(key, Match.anyValue());
    }
  });
});
