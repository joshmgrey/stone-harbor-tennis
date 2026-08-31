import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  DatabaseStack,
  type DatabaseStackProps,
} from "../lib/database-stack";

const ENV = { account: "123456789012", region: "us-east-2" };

const BASE: Omit<DatabaseStackProps, "env"> = {
  dbInstanceIdentifier: "tennis",
  engineVersion: "17.5",
  allocatedStorageGib: 20,
  vpcId: "vpc-12345678",
  dbSubnetGroupName: "default",
  appSecurityGroupId: "sg-app00000000000",
  masterUsername: "postgres",
  masterCredentialsSecretArn:
    "arn:aws:secretsmanager:us-east-2:123456789012:secret:stone-harbor-tennis/rds/master-AbCdEf",
};

function synth(overrides: Partial<DatabaseStackProps> = {}): Template {
  const app = new cdk.App();
  const stack = new DatabaseStack(app, "DatabaseStack", {
    env: ENV,
    synthesizer: new cdk.CliCredentialsStackSynthesizer(),
    ...BASE,
    ...overrides,
  });
  return Template.fromStack(stack);
}

describe("DatabaseStack", () => {
  it("adopts exactly one RDS instance", () => {
    synth().resourceCountIs("AWS::RDS::DBInstance", 1);
  });

  it("keeps the imported instance private and non-destructible", () => {
    const t = synth();
    t.hasResourceProperties("AWS::RDS::DBInstance", {
      PubliclyAccessible: false,
      StorageEncrypted: true,
      DeletionProtection: true,
      MultiAZ: false,
      DBInstanceClass: "db.t3.micro",
      Engine: "postgres",
      EngineVersion: "17.5",
      AllocatedStorage: "20",
      MaxAllocatedStorage: 1000,
      BackupRetentionPeriod: 7,
    });
  });

  it("retains the instance if the stack is deleted", () => {
    synth().hasResource("AWS::RDS::DBInstance", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("omits DBName unless one is explicitly configured", () => {
    const withoutName = synth();
    const instances = withoutName.findResources("AWS::RDS::DBInstance");
    const [onlyInstance] = Object.values(instances);
    expect(onlyInstance.Properties).not.toHaveProperty("DBName");

    synth({ databaseName: "tennis" }).hasResourceProperties(
      "AWS::RDS::DBInstance",
      { DBName: "tennis" },
    );
  });

  it("gives the instance a security group that admits 5432 only from the app SG", () => {
    const t = synth();
    t.resourceCountIs("AWS::EC2::SecurityGroup", 1);
    t.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupIngress: [
        Match.objectLike({
          IpProtocol: "tcp",
          FromPort: 5432,
          ToPort: 5432,
          SourceSecurityGroupId: "sg-app00000000000",
        }),
      ],
    });
  });

  it("does not open the database to any CIDR range", () => {
    const [sg] = Object.values(
      synth().findResources("AWS::EC2::SecurityGroup"),
    );
    const ingress = (sg.Properties?.SecurityGroupIngress ?? []) as Array<
      Record<string, unknown>
    >;
    expect(ingress.length).toBeGreaterThan(0);
    for (const rule of ingress) {
      expect(rule).not.toHaveProperty("CidrIp");
      expect(rule).not.toHaveProperty("CidrIpv6");
    }
  });

  it("wires the master credentials from the pre-created secret", () => {
    synth().hasResourceProperties("AWS::RDS::DBInstance", {
      MasterUsername: "postgres",
      MasterUserPassword: Match.stringLikeRegexp(
        "{{resolve:secretsmanager:.*stone-harbor-tennis/rds/master.*:SecretString:password",
      ),
    });
    // fromSecret attaches the secret to the instance.
    synth().resourceCountIs("AWS::SecretsManager::SecretTargetAttachment", 1);
  });

  it("passes the KMS key through only when supplied", () => {
    const withoutKey = synth();
    const [instance] = Object.values(
      withoutKey.findResources("AWS::RDS::DBInstance"),
    );
    expect(instance.Properties).not.toHaveProperty("KmsKeyId");

    synth({
      kmsKeyArn:
        "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012",
    }).hasResourceProperties("AWS::RDS::DBInstance", {
      KmsKeyId: Match.anyValue(),
    });
  });

  it("exports the endpoint and master-secret ARN", () => {
    const t = synth();
    t.hasOutput("DbEndpoint", Match.anyValue());
    t.hasOutput("DbMasterSecretArn", Match.anyValue());
  });
});
