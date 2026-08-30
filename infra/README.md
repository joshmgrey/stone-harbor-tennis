# infra — AWS CDK

Infrastructure-as-code for Stone Harbor Invitational Tennis.

**Status: Path A — adopt the existing RDS instance, no behavioural changes.**

The database is a manually-provisioned, publicly-accessible RDS PostgreSQL 17
instance (see the main [README](../README.md#deployment-aws)).
`DatabaseStack` describes that instance property-for-property so `cdk import`
can adopt it with an **empty diff**. The synthesized template is a single
`AWS::RDS::DBInstance`, so the import can't be blocked by a non-importable
resource type. The instance stays public. Moving it into a private VPC is a
later, separate change.

## Layout

```
infra/
├── bin/infra.ts             CDK app entrypoint; wires context -> DatabaseStack
├── lib/database-stack.ts     the instance, described for import
├── cdk.json                  app command + feature flags (committed)
├── cdk.context.json          db:* / env:* values + VPC lookup cache (GITIGNORED)
└── tsconfig.json
```

## Context is gitignored

This repo is **public**. `cdk.context.json` holds the AWS account id, VPC /
subnet / security-group ids, the KMS key ARN, the secret ARN and the resolved
subnet layout — a map of the environment. It is **not committed**. Keep your
values there locally, or pass them with `-c key=value`. CI / another machine
re-derives the lookup cache from AWS credentials and re-supplies `db:*`.

`infra/cdk.context.json` (create if missing — all values are placeholders
here on purpose; fill from the RDS console / the query below):

```json
{
  "env:account": "<account id>",
  "env:region": "us-east-2",
  "db:instanceIdentifier": "tennis",
  "db:engineVersion": "17.9",
  "db:allocatedStorageGib": "20",
  "db:vpcId": "vpc-XXXXXXXX",
  "db:subnetGroupName": "default-vpc-XXXXXXXX",
  "db:securityGroupId": "sg-XXXXXXXX",
  "db:masterUsername": "postgres",
  "db:kmsKeyArn": "arn:aws:kms:us-east-2:<account id>:key/XXXXXXXX",
  "db:masterSecretArn": "<fill in after creating the secret — see below>"
}
```

`db:databaseName` is intentionally absent — the live instance's `DBName` is
null (the app's `.../postgres` URL uses the built-in database, which is not
`DBName`). `DBName` is create-only; setting it would make a deploy replace
the instance.

To re-derive these values:

```bash
aws rds describe-db-instances --db-instance-identifier tennis --region us-east-2 --query 'DBInstances[0].{engine:EngineVersion,storage:AllocatedStorage,maxStorage:MaxAllocatedStorage,storageType:StorageType,encrypted:StorageEncrypted,kmsKey:KmsKeyId,multiAz:MultiAZ,public:PubliclyAccessible,backupDays:BackupRetentionPeriod,deleteProtection:DeletionProtection,subnetGroup:DBSubnetGroup.DBSubnetGroupName,vpc:DBSubnetGroup.VpcId,sgs:VpcSecurityGroups[].VpcSecurityGroupId,masterUser:MasterUsername,dbName:DBName,class:DBInstanceClass}'
```

Values already baked into `lib/database-stack.ts` (matched to the live
instance): `db.t3.micro`, `gp2`, storage encrypted, autoscaling ceiling
1000 GiB, single-AZ, 7-day backups, deletion protection on.

## One-time setup

```bash
cd infra && npm install
```

`cdk bootstrap` is **not** required. This stack uses
`CliCredentialsStackSynthesizer` (see `bin/infra.ts`) — every CloudFormation
call runs with your CLI credentials, no bootstrap roles or staging bucket.
`cdk import` rejects the bootstrap exec role (`RoleArn`) and stack tags, so
the stack carries neither.

## Create the credentials secret

The password is the one already in your Amplify `DATABASE_URL`:

```bash
aws secretsmanager create-secret --region us-east-2 --name stone-harbor-tennis/rds/master --secret-string '{"username":"postgres","password":"<CURRENT_PASSWORD>"}'
```

Put the returned ARN in `db:masterSecretArn`.

## Import the instance

```bash
npx cdk synth DatabaseStack
```

```bash
npx cdk import DatabaseStack
```

Feed it the identifier `tennis` when prompted.

```bash
npx cdk diff DatabaseStack
```

**Must be empty** — no added/removed resources, no property changes.

Any diff means a context value is wrong. **Fix it — do not deploy.** A diff
on a create-only property (`DBName`, `MasterUsername`, engine version,
`StorageEncrypted`, `KmsKeyId`, instance class, VPC/subnet group) means a
deploy would **replace** the database.

If `cdk diff` shows a `KmsKeyId` change, set `db:kmsKeyArn` to the ARN it
reports and re-run `cdk import`.

## After a clean import

1. **Secret attachment — done.** Credentials use `rds.Credentials.fromSecret`,
   which adds `AWS::SecretsManager::SecretTargetAttachment`. `MasterUsername` /
   `MasterUserPassword` render identically to the imported state, so
   `cdk deploy` adds only the attachment — no instance change. The attachment
   merges `host` / `port` / `dbname` / `engine` into the secret alongside
   `password`, so a future app stack can build the connection from one secret.
2. Path B / Phase A2: introduce the dedicated VPC. An RDS instance can't
   change VPC in place, so this is snapshot → restore into the new VPC →
   repoint `DATABASE_URL` → retire the old instance.
