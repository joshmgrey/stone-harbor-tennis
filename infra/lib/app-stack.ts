import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as logs from "aws-cdk-lib/aws-logs";

export interface AppStackProps extends cdk.StackProps {
  /** The default VPC — the app and the database share it (no new VPC). */
  readonly vpcId: string;

  /**
   * Route 53 hosted zone that owns the domain. The cert covers the apex,
   * `www.`, and `new.` (the B2/B3 test host) so B3 is just adding records.
   */
  readonly hostedZoneId: string;
  readonly zoneName: string;

  /** NEXT_PUBLIC_ — inlined into the client bundle when the image is built. */
  readonly googleMapsApiKey: string;

  /** Secrets Manager ARN holding the full `DATABASE_URL` connection string. */
  readonly databaseUrlSecretArn: string;

  /** Secrets Manager ARN holding the admin password (`AUTH_SECRET`). */
  readonly authSecretArn: string;
}

/**
 * B2 — the Next.js app on Fargate behind an ALB, in the default VPC.
 *
 * `DATABASE_URL` points at the existing (still public) RDS instance, so this
 * runs side-by-side with Amplify against the same data. B3 flips DNS; B4
 * takes the database private.
 *
 * Deploys from CI only — the image is a Docker asset and the dev machine has
 * no Docker.
 */
export class AppStack extends cdk.Stack {
  /** The Fargate service SG — B4 adds it to the RDS security group. */
  public readonly serviceSecurityGroupId: string;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "Vpc", { vpcId: props.vpcId });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });

    const wwwDomain = `www.${props.zoneName}`;
    // Test hostname for B2/B3. The real cutover (apex + www records) is B3.
    const stagingDomain = `new.${props.zoneName}`;

    const certificate = new acm.Certificate(this, "Cert", {
      domainName: props.zoneName,
      subjectAlternativeNames: [wwwDomain, stagingDomain],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const databaseUrl = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "DatabaseUrlSecret",
      props.databaseUrlSecretArn,
    );
    const authSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "AuthSecret",
      props.authSecretArn,
    );

    const logGroup = new logs.LogGroup(this, "Logs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const cluster = new ecs.Cluster(this, "Cluster", { vpc });

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "Service",
      {
        cluster,
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 1,
        // Keep one healthy task through a deploy: ECS runs a second task,
        // waits for it to pass health checks, then drains the old one. No
        // request is dropped even with desiredCount 1.
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        circuitBreaker: { rollback: true },

        // The default VPC has only public subnets, and there is no NAT
        // gateway — the task needs a public IP to reach ECR / Secrets
        // Manager / CloudWatch. Inbound is still closed except from the ALB.
        assignPublicIp: true,
        taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },

        publicLoadBalancer: true,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificate,
        redirectHTTP: true,
        domainName: stagingDomain,
        domainZone: zone,

        taskImageOptions: {
          image: ecs.ContainerImage.fromAsset(
            path.join(__dirname, "..", ".."),
            {
              file: "Dockerfile",
              target: "runner",
              platform: ecrAssets.Platform.LINUX_AMD64,
              buildArgs: {
                NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: props.googleMapsApiKey,
              },
            },
          ),
          containerPort: 3000,
          environment: {
            NODE_ENV: "production",
            PORT: "3000",
            HOSTNAME: "0.0.0.0",
          },
          secrets: {
            DATABASE_URL: ecs.Secret.fromSecretsManager(databaseUrl),
            AUTH_SECRET: ecs.Secret.fromSecretsManager(authSecret),
          },
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: "app",
            logGroup,
          }),
        },
      },
    );

    service.targetGroup.configureHealthCheck({
      path: "/api/health",
      healthyHttpCodes: "200",
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(5),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });
    service.targetGroup.setAttribute(
      "deregistration_delay.timeout_seconds",
      "20",
    );

    this.serviceSecurityGroupId =
      service.service.connections.securityGroups[0].securityGroupId;

    // B3 — the cutover. Point the apex and www at the ALB.
    //
    // `deleteExisting` removes the record Amplify created right before the new
    // one (a custom resource), keeping the gap to seconds. It only matches the
    // SAME record type, though: Amplify's apex is an A-alias (fine), but www
    // is a CNAME — an A record there would collide, so www stays a CNAME
    // (pointing at the ALB's own DNS name) and `deleteExisting` can clear it.
    const albTarget = route53.RecordTarget.fromAlias(
      new route53Targets.LoadBalancerTarget(service.loadBalancer),
    );
    new route53.ARecord(this, "ApexRecord", {
      zone,
      // no recordName -> the zone apex; an apex cannot be a CNAME, so alias
      target: albTarget,
      deleteExisting: true,
    });
    new route53.CnameRecord(this, "WwwRecord", {
      zone,
      recordName: wwwDomain,
      domainName: service.loadBalancer.loadBalancerDnsName,
      ttl: cdk.Duration.minutes(5),
      deleteExisting: true,
    });

    new cdk.CfnOutput(this, "SiteUrl", {
      value: `https://${props.zoneName}`,
    });
    new cdk.CfnOutput(this, "StagingUrl", {
      value: `https://${stagingDomain}`,
    });
    new cdk.CfnOutput(this, "AlbDnsName", {
      value: service.loadBalancer.loadBalancerDnsName,
    });
    new cdk.CfnOutput(this, "ServiceSecurityGroupId", {
      value: this.serviceSecurityGroupId,
      description: "put in db:appSecurityGroupId context for B4",
    });
  }
}
