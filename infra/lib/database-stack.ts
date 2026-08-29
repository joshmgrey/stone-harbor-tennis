import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

/**
 * Path A — codify the EXISTING, manually-provisioned RDS instance.
 *
 * The goal of this stack is to describe the database that is already running
 * (README "Deployment (AWS)") closely enough that `cdk import` can adopt it
 * with zero changes. It intentionally keeps the instance PUBLICLY ACCESSIBLE
 * for now. Locking it into a private subnet is Path B and is a separate,
 * deliberate change (it replaces the instance).
 *
 * Every value that must byte-for-byte match the live instance for a clean
 * import is exposed as a prop with NO default, so you are forced to fill it
 * in from `aws rds describe-db-instances` rather than guess. See the block
 * comment at the bottom for the exact CLI queries.
 */
export interface DatabaseStackProps extends cdk.StackProps {
  /**
   * The live instance's `DBInstanceIdentifier`. `cdk import` matches on this.
   * e.g. "stone-harbor-tennis-db"
   */
  readonly dbInstanceIdentifier: string;

  /**
   * Exact engine version the live instance reports, e.g. "17.5".
   * Auto minor upgrades mean this drifts over time — read it, don't assume.
   */
  readonly engineVersion: string;

  /**
   * Allocated storage in GiB on the live instance (console default is 20).
   */
  readonly allocatedStorageGib: number;

  /**
   * The VPC the live instance actually sits in. A console-created "publicly
   * accessible" instance is almost always in the account's DEFAULT VPC.
   * Pass its id (vpc-xxxx) so the lookup is unambiguous.
   */
  readonly vpcId: string;

  /**
   * The DB subnet group name the live instance uses. Console-created
   * instances in the default VPC usually get one literally named "default".
   */
  readonly dbSubnetGroupName: string;

  /**
   * Id of the security group that currently fronts the instance — the one
   * with the `0.0.0.0/0 : 5432` inbound rule from README step 2. We reference
   * it, we do NOT recreate it, so the open rule stays exactly as-is and
   * unmanaged until you decide to tighten it.
   */
  readonly dbSecurityGroupId: string;

  /**
   * The live instance's `MasterUsername`. CREATE-ONLY on the CloudFormation
   * resource — a mismatch here makes a later deploy want to REPLACE the
   * instance. Read it from `describe-db-instances`, do not assume "postgres".
   */
  readonly masterUsername: string;

  /**
   * The live instance's `DBName` (the initial database set at creation), or
   * omit if none was set.
   *
   * CREATE-ONLY, and this is the trap: the app's connection string ending in
   * `/postgres` does NOT mean `DBName` is "postgres" — `postgres` is the
   * built-in database that always exists. A console instance created without
   * an explicit "Initial database name" has `DBName` = null. If
   * `describe-db-instances` shows `DBName: null`, leave this UNSET; setting it
   * to "postgres" would make a later deploy replace the instance.
   */
  readonly databaseName?: string;

  /**
   * ARN of a Secrets Manager secret you create BEFORE importing, containing
   * the instance's CURRENT password as `{ "password": "..." }` (a `username`
   * key is fine too but unused). See bottom comment for how.
   */
  readonly masterCredentialsSecretArn: string;
}

export class DatabaseStack extends cdk.Stack {
  /** The adopted instance, for other stacks to reference (e.g. an app stack). */
  public readonly instance: rds.IDatabaseInstance;

  /** The master-credentials secret, so an app stack can grant read + inject it. */
  public readonly credentialsSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------------
    // 1. VPC
    // ---------------------------------------------------------------------
    // `fromLookup` performs a real describe call at synth time and caches the
    // result in cdk.context.json. It does NOT create anything. We look the
    // VPC up (rather than `Vpc.fromVpcAttributes`) so CDK learns the subnet
    // layout, which `DatabaseInstance` needs to place the instance.
    //
    // DIVERGENCE / GOTCHA: you asked for a NEW dedicated VPC. That cannot
    // happen in the same step as `cdk import` — the live instance lives in
    // the VPC it lives in, and moving an RDS instance between VPCs is a
    // destroy+recreate. Sequence:
    //   A1 (this file)  import the instance where it is
    //   A2 (later PR)   snapshot -> restore into the new VPC -> cut over
    // So this stack targets the *existing* VPC on purpose.
    const vpc = ec2.Vpc.fromLookup(this, "DbVpc", { vpcId: props.vpcId });

    // ---------------------------------------------------------------------
    // 2. Security group (referenced, not created)
    // ---------------------------------------------------------------------
    // The instance's `VpcSecurityGroups` must match the live value for the
    // import to be a no-op, so we point at the existing SG by id. Its
    // inbound `0.0.0.0/0 : 5432` rule is left untouched and outside CDK's
    // control. `mutable: false` stops CDK from trying to add rules to it.
    const dbSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "DbSecurityGroup",
      props.dbSecurityGroupId,
      { mutable: false },
    );

    // ---------------------------------------------------------------------
    // 3. DB subnet group (referenced, not created)
    // ---------------------------------------------------------------------
    // Same reasoning: `DBSubnetGroupName` is compared on import. Referencing
    // the existing group avoids CDK generating a new one and showing drift.
    const subnetGroup = rds.SubnetGroup.fromSubnetGroupName(
      this,
      "DbSubnetGroup",
      props.dbSubnetGroupName,
    );

    // ---------------------------------------------------------------------
    // 4. Master credentials
    // ---------------------------------------------------------------------
    // The live instance was created with a password typed into the console
    // and pasted into `DATABASE_URL` (README step 4). `MasterUserPassword`
    // is a write-only property: CloudFormation import ignores it, and a
    // later deploy only touches it if the rendered value *changes*.
    //
    // We import the secret purely so the stack can expose it (below) and an
    // app stack can grant read on it. We deliberately DO NOT pass it to
    // `Credentials.fromSecret()` — that helper always emits an
    // `AWS::SecretsManager::SecretTargetAttachment`, and that resource type
    // is NOT importable. `cdk import` builds one IMPORT change set from the
    // whole synthesized template, so a non-importable new resource makes the
    // import fail before the instance is ever adopted. Instead we feed the
    // password straight in as a dynamic reference via `fromPassword` — the
    // rendered template then contains exactly one resource, the importable
    // `AWS::RDS::DBInstance`.
    //
    // (Post-import hardening step: switch to `Credentials.fromSecret()` or add
    //  an explicit `SecretTargetAttachment` via `cdk deploy` so the secret
    //  also carries host/port/dbname for the app stack to consume.)
    //
    // DIVERGENCE: today there is NO secret — the password lives only in the
    // Amplify env var. This introduces Secrets Manager as the source of truth.
    const credentialsSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "DbMasterSecret",
      props.masterCredentialsSecretArn,
    );

    // ---------------------------------------------------------------------
    // 5. The instance itself
    // ---------------------------------------------------------------------
    const instance = new rds.DatabaseInstance(this, "Instance", {
      // Must equal the live identifier for `cdk import` to match on it.
      instanceIdentifier: props.dbInstanceIdentifier,

      // Postgres 17. Pin the exact minor from the live instance; a bare
      // `VER_17` would let AWS choose and can mismatch on import.
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of(
          props.engineVersion,
          props.engineVersion.split(".")[0],
        ),
      }),

      // t4g.micro — Graviton burstable, the smallest current-gen class.
      // If your console instance is db.t3.micro (x86) change T4G -> T3.
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO,
      ),

      vpc,
      subnetGroup,
      securityGroups: [dbSecurityGroup],

      // The whole point of Path A: stay reachable from the public internet
      // (Amplify SSR has no VPC route to a private instance). SSL is still
      // enforced app-side via the `pg` adapter (`src/lib/prisma.ts`).
      publiclyAccessible: true,

      // `MasterUsername` (create-only) comes from context; the password is a
      // `{{resolve:secretsmanager:...}}` dynamic reference — never rendered
      // in plaintext, and ignored by `cdk import` as a write-only property.
      credentials: rds.Credentials.fromPassword(
        props.masterUsername,
        cdk.SecretValue.secretsManager(props.masterCredentialsSecretArn, {
          jsonField: "password",
        }),
      ),

      // `DBName` is CREATE-ONLY. Only set it if the live instance actually has
      // one (see the prop doc). When `db:databaseName` is unset we omit the
      // property entirely so CloudFormation keeps whatever the live value is.
      ...(props.databaseName ? { databaseName: props.databaseName } : {}),

      allocatedStorage: props.allocatedStorageGib,
      // Storage autoscaling ceiling. If the live instance has "Enable storage
      // autoscaling" OFF, delete this line so import doesn't see a diff.
      maxAllocatedStorage: 100,

      // Console default for new Postgres instances is gp3. If your instance
      // predates that or shows "gp2", switch to `rds.StorageType.GP2`.
      storageType: rds.StorageType.GP3,

      // DIVERGENCE (likely): console instances are often created WITHOUT
      // "Encryption" ticked. `storageEncrypted` is immutable — if the live
      // instance is unencrypted this MUST be `false` for import, and turning
      // it on later is a snapshot-copy migration. Read the live value.
      storageEncrypted: false,

      // Single-AZ today (README: Multi-AZ only "if needed"). Toggling this
      // on later is an online change, safe to defer.
      multiAz: false,

      // RDS console default backup retention is 7 days; the CLI/older console
      // default is 1. Set this to whatever `BackupRetentionPeriod` reports.
      backupRetention: cdk.Duration.days(7),

      // Keep automated backups if the instance is ever deleted.
      deleteAutomatedBackups: false,

      // DIVERGENCE / RECOMMENDATION: almost certainly OFF on your instance.
      // Must be `false` to import cleanly; flip to `true` in the very next
      // deploy — it's a zero-downtime change and stops `cdk destroy` /
      // console fat-fingers from dropping the league's data.
      deletionProtection: false,

      // CDK's default for DatabaseInstance is SNAPSHOT. RETAIN is safer: if
      // this stack is ever deleted, the instance stays put untouched.
      removalPolicy: cdk.RemovalPolicy.RETAIN,

      // Console default is ON; keeps you on latest 17.x automatically. This
      // is why `engineVersion` above must be read, not hard-coded forever.
      autoMinorVersionUpgrade: true,
    });

    this.instance = instance;
    this.credentialsSecret = credentialsSecret;

    // ---------------------------------------------------------------------
    // 6. Outputs
    // ---------------------------------------------------------------------
    // After import, confirm this endpoint matches the host in your Amplify
    // `DATABASE_URL`. It should — import doesn't move anything.
    new cdk.CfnOutput(this, "DbEndpoint", {
      value: instance.dbInstanceEndpointAddress,
      description: "Host for DATABASE_URL",
    });
    new cdk.CfnOutput(this, "DbPort", {
      value: instance.dbInstanceEndpointPort,
    });
    new cdk.CfnOutput(this, "DbMasterSecretArn", {
      value: credentialsSecret.secretArn,
      description: "Secrets Manager ARN holding master username/password",
    });
  }
}

/*
 * ---------------------------------------------------------------------------
 * READING THE LIVE VALUES  (fill the props from this)
 * ---------------------------------------------------------------------------
 *
 *   ID=<your-db-instance-id>
 *
 *   aws rds describe-db-instances --db-instance-identifier "$ID" \
 *     --query 'DBInstances[0].{
 *        engine:EngineVersion,
 *        storage:AllocatedStorage,
 *        storageType:StorageType,
 *        encrypted:StorageEncrypted,
 *        multiAz:MultiAZ,
 *        public:PubliclyAccessible,
 *        backupDays:BackupRetentionPeriod,
 *        deleteProtection:DeletionProtection,
 *        subnetGroup:DBSubnetGroup.DBSubnetGroupName,
 *        vpc:DBSubnetGroup.VpcId,
 *        sgs:VpcSecurityGroups[].VpcSecurityGroupId,
 *        masterUser:MasterUsername,
 *        dbName:DBName,
 *        instanceClass:DBInstanceClass
 *     }'
 *
 *   -> masterUser  goes to  db:masterUsername
 *   -> dbName      goes to  db:databaseName  ONLY if non-null; if it prints
 *                  `null` / is absent, leave db:databaseName unset.
 *
 * Create the credentials secret from the password you already have:
 *
 *   aws secretsmanager create-secret \
 *     --name stone-harbor-tennis/rds/master \
 *     --secret-string '{"password":"<CURRENT PASSWORD>"}'
 *
 * ---------------------------------------------------------------------------
 * IMPORT SEQUENCE
 * ---------------------------------------------------------------------------
 *   1. cdk bootstrap                      (once per account/region)
 *   2. cdk synth DatabaseStack            (must synth with concrete env)
 *   3. cdk import DatabaseStack           feed it the DBInstanceIdentifier.
 *                                        The template has ONE resource
 *                                        (AWS::RDS::DBInstance), which is
 *                                        importable, so this succeeds.
 *   4. cdk diff DatabaseStack             MUST be empty — no added/removed
 *                                        resources, no property changes. Any
 *                                        diff means a context value is wrong;
 *                                        fix it, do NOT deploy. (A diff on a
 *                                        create-only prop — DBName,
 *                                        MasterUsername, engine, storage
 *                                        encryption — means a deploy would
 *                                        REPLACE the instance.)
 *   5. commit cdk.context.json
 *
 * Only once step 4 is clean do you start changing things (turn on
 * deletionProtection, wire the SecretTargetAttachment, then Path B).
 * ---------------------------------------------------------------------------
 */
