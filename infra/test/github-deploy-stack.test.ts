import { describe, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  GitHubDeployStack,
  type GitHubDeployStackProps,
} from "../lib/github-deploy-stack";

const ENV = { account: "123456789012", region: "us-east-2" };
const OWNER_REPO = "joshmgrey/stone-harbor-tennis";

function synth(props: Partial<GitHubDeployStackProps> = {}): Template {
  const app = new cdk.App();
  const stack = new GitHubDeployStack(app, "GitHubDeployStack", {
    env: ENV,
    ownerRepo: OWNER_REPO,
    ...props,
  });
  return Template.fromStack(stack);
}

describe("GitHubDeployStack", () => {
  it("creates a native GitHub OIDC provider scoped to sts.amazonaws.com", () => {
    const t = synth();
    t.hasResourceProperties("AWS::IAM::OIDCProvider", {
      Url: "https://token.actions.githubusercontent.com",
      ClientIdList: ["sts.amazonaws.com"],
    });
    t.resourceCountIs("AWS::IAM::Role", 1);
  });

  it("reuses an existing OIDC provider when its ARN is supplied", () => {
    const t = synth({
      existingOidcProviderArn:
        "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com",
    });
    t.resourceCountIs("AWS::IAM::OIDCProvider", 0);
  });

  it("names the deploy role and caps the session at one hour", () => {
    synth().hasResourceProperties("AWS::IAM::Role", {
      RoleName: "stone-harbor-tennis-github-deploy",
      MaxSessionDuration: 3600,
    });
  });

  it("trusts both the branch-ref and the production-environment sub claims", () => {
    synth().hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              },
              StringLike: {
                "token.actions.githubusercontent.com:sub": [
                  `repo:${OWNER_REPO}:ref:refs/heads/main`,
                  `repo:${OWNER_REPO}:environment:production`,
                ],
              },
            },
          }),
        ]),
      },
    });
  });

  it("custom sub claims override the defaults", () => {
    synth({ subjectClaims: ["repo:joshmgrey/stone-harbor-tennis:pull_request"] })
      .hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Condition: Match.objectLike({
                StringLike: {
                  "token.actions.githubusercontent.com:sub": [
                    "repo:joshmgrey/stone-harbor-tennis:pull_request",
                  ],
                },
              }),
            }),
          ]),
        },
      });
  });

  it("only lets the role assume the CDK bootstrap roles, not CloudFormation directly", () => {
    synth().hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "AssumeCdkBootstrapRoles",
            Action: "sts:AssumeRole",
            Resource: "arn:aws:iam::123456789012:role/cdk-hnb659fds-*",
          }),
        ]),
      },
    });
  });

  it("scopes secret reads to the project namespace", () => {
    synth().hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "ReadProjectSecrets",
            Action: "secretsmanager:GetSecretValue",
            Resource:
              "arn:aws:secretsmanager:*:123456789012:secret:stone-harbor-tennis/*",
          }),
        ]),
      },
    });
  });

  it("scopes iam:PassRole to AppStack task roles for ECS only", () => {
    synth().hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "PassEcsTaskRoles",
            Action: "iam:PassRole",
            Resource: "arn:aws:iam::123456789012:role/AppStack-*",
            Condition: {
              StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
            },
          }),
        ]),
      },
    });
  });

  it("exports the role ARN for the workflow to assume", () => {
    synth().hasOutput("DeployRoleArn", Match.anyValue());
  });
});
