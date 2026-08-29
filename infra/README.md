# infra — AWS CDK

Infrastructure-as-code for Stone Harbor Invitational Tennis.

**Status: Path A — adopt the existing RDS instance, no behavioural changes.**

The database is currently a manually-provisioned, publicly-accessible RDS
PostgreSQL 17 instance (see the main [README](../README.md#deployment-aws)).
`DatabaseStack` describes that instance closely enough for `cdk import` to
take it over with an empty diff. It stays public. Moving it into a private
VPC is a later, separate change.

## Layout

```
infra/
├── bin/infra.ts            CDK app entrypoint; wires context -> DatabaseStack
├── lib/database-stack.ts    the instance, described for import
├── cdk.json                 app command + feature flags
└── tsconfig.json
```

## One-time setup

```bash
cd infra
npm install
npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

## Fill in the live values

Every `DatabaseStack` prop must match the running instance exactly or the
import will not be clean. Read them:

```bash
ID=<your-db-instance-id>
aws rds describe-db-instances --db-instance-identifier "$ID" \
  --query 'DBInstances[0].{
    engine:EngineVersion, storage:AllocatedStorage, storageType:StorageType,
    encrypted:StorageEncrypted, multiAz:MultiAZ, public:PubliclyAccessible,
    backupDays:BackupRetentionPeriod, deleteProtection:DeletionProtection,
    subnetGroup:DBSubnetGroup.DBSubnetGroupName, vpc:DBSubnetGroup.VpcId,
    sgs:VpcSecurityGroups[].VpcSecurityGroupId, masterUser:MasterUsername,
    class:DBInstanceClass }'
```

Create a secret holding the **current** master credentials (the password is
the one already in your Amplify `DATABASE_URL`):

```bash
aws secretsmanager create-secret \
  --name stone-harbor-tennis/rds/master \
  --secret-string '{"username":"postgres","password":"<CURRENT_PASSWORD>"}'
```

Then add the values to `cdk.json` under `"context"`:

```json
"context": {
  "db:instanceIdentifier": "stone-harbor-tennis-db",
  "db:engineVersion": "17.5",
  "db:allocatedStorageGib": "20",
  "db:vpcId": "vpc-0abc...",
  "db:subnetGroupName": "default",
  "db:securityGroupId": "sg-0abc...",
  "db:masterSecretArn": "arn:aws:secretsmanager:us-east-1:1234:secret:stone-harbor-tennis/rds/master-AbCdEf"
}
```

Account/region are taken from your active AWS credentials automatically
(`CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`). Override with
`-c env:account=... -c env:region=...` if needed.

Also review the placeholder assumptions in `lib/database-stack.ts` marked
`DIVERGENCE` — `storageEncrypted`, `storageType`, `backupRetention`,
`instanceType`, and the master username all need confirming against the
output above.

## Import the instance

```bash
npx cdk synth DatabaseStack          # must synth with a concrete env
npx cdk import DatabaseStack          # prompts for the DBInstanceIdentifier
npx cdk diff DatabaseStack
```

Only the `AWS::RDS::DBInstance` is imported. The acceptable `cdk diff` after
import is **exactly one added resource** —
`AWS::SecretsManager::SecretTargetAttachment` (it writes host/port/dbname
back into your secret; additive and safe) — and **zero changes on the
instance itself**.

If `cdk diff` shows any change to `AWS::RDS::DBInstance`, a prop is wrong.
**Fix the prop — do not deploy.** A deploy with a mismatch on an immutable
property (engine version, encryption, VPC/subnet group) will try to replace
the instance.

Then:

```bash
npx cdk deploy DatabaseStack         # creates the SecretTargetAttachment
```

Commit `cdk.context.json` (it caches the VPC lookup so teammates and CI
resolve the same subnets) and `cdk.json`.

## After a clean import

1. Set `deletionProtection: true` in `lib/database-stack.ts` and
   `npx cdk deploy` — zero-downtime, and it stops accidental drops.
2. Path B / Phase A2: introduce the dedicated VPC. Because an RDS instance
   cannot change VPC in place, this is snapshot → restore into the new VPC →
   repoint `DATABASE_URL` → retire the old instance.
