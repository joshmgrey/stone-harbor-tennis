import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";

const GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com";

export interface GitHubDeployStackProps extends cdk.StackProps {
  /** "owner/repo" whose Actions runs may assume the deploy role. */
  readonly ownerRepo: string;

  /**
   * OIDC `sub` claim to trust. Default: this repo's `main` branch only.
   * Widen (e.g. `repo:owner/repo:*`) only with a reason — a looser claim
   * lets any branch or PR from the repo assume the role.
   */
  readonly subjectClaim?: string;

  /**
   * ARN of an existing GitHub OIDC provider in this account. AWS allows only
   * ONE provider per URL per account, so if another project already created
   * `token.actions.githubusercontent.com`, pass its ARN here instead of
   * creating a duplicate (which would fail).
   */
  readonly existingOidcProviderArn?: string;
}

/**
 * B0 — lets GitHub Actions run `cdk deploy` without long-lived AWS keys.
 *
 * Deploy this once from your laptop (`cdk deploy GitHubDeployStack`) after
 * `cdk bootstrap`. Everything else can then deploy from CI.
 */
export class GitHubDeployStack extends cdk.Stack {
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubDeployStackProps) {
    super(scope, id, props);

    // Native CloudFormation OIDC provider — no custom-resource Lambda. AWS
    // stopped validating the IdP TLS thumbprint for this well-known provider,
    // but CloudFormation still requires the property; these are GitHub's
    // published values.
    const providerArn: string =
      props.existingOidcProviderArn ??
      new iam.CfnOIDCProvider(this, "GitHubOidc", {
        url: GITHUB_OIDC_URL,
        clientIdList: ["sts.amazonaws.com"],
        thumbprintList: [
          "6938fd4d98bab03faadb97b34396831e3780aea1",
          "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
        ],
      }).attrArn;

    const subjectClaim =
      props.subjectClaim ?? `repo:${props.ownerRepo}:ref:refs/heads/main`;

    this.deployRole = new iam.Role(this, "DeployRole", {
      roleName: "stone-harbor-tennis-github-deploy",
      description: `cdk deploy from GitHub Actions (${props.ownerRepo})`,
      // GitHub tokens are short-lived; the session doesn't need to outlast a
      // deploy.
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": subjectClaim,
        },
      }),
    });

    // With modern CDK bootstrap, a CI principal never touches CloudFormation,
    // S3 or ECR directly — it only assumes the bootstrap roles, which carry
    // the real permissions and are themselves scoped by the bootstrap
    // template. So this is the entire policy the deploy role needs.
    //
    // NOTE: this does NOT cover `DatabaseStack`, which uses
    // `CliCredentialsStackSynthesizer` (deploys with the caller's own
    // permissions, not the bootstrap roles). Keep deploying that one from
    // your laptop — it changes rarely.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AssumeCdkBootstrapRoles",
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
      }),
    );

    new cdk.CfnOutput(this, "DeployRoleArn", {
      value: this.deployRole.roleArn,
      description: "role-to-assume for the GitHub Actions workflow",
    });
    new cdk.CfnOutput(this, "OidcProviderArn", {
      value: providerArn,
      description: "pass as github:oidcProviderArn if you rebuild this stack",
    });
  }
}
