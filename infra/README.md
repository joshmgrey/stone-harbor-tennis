# infra — AWS CDK

Infrastructure-as-code for Stone Harbor Invitational Tennis.

**Status: Path A — adopt the existing RDS instance, no behavioural changes.**

The database is currently a manually-provisioned, publicly-accessible RDS
PostgreSQL 17 instance (see the main [README](../README.md#deployment-aws)).
`DatabaseStack` describes that instance closely enough for `cdk import` to
take it over with an **empty diff**. The synthesized template contains a
single resource (`AWS::RDS::DBInstance`) so the import cannot be blocked by a
non-importable resource type. It stays public. Moving it into a private VPC
is a later, separate change.

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
    dbName:DBName, class:DBInstanceClass }'
```

**`dbName`**: if this comes back `null` (common — a console instance created
without an explicit "Initial database name"), leave `db:databaseName` unset.
The app's `.../postgres` connection string uses the built-in `postgres`
database, which is not the same as `DBName`. `DBName` is create-only, so
setting it wrong makes a later deploy **replace** the instance.

Create a secret holding the **current** master password (the one already in
your Amplify `DATABASE_URL`):

```bash
aws secretsmanager create-secret \
  --name stone-harbor-tennis/rds/master \
  --secret-string '{"password":"<CURRENT_PASSWORD>"}'
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
  "db:masterUsername": "postgres",
  "db:masterSecretArn": "arn:aws:secretsmanager:us-east-1:1234:secret:stone-harbor-tennis/rds/master-AbCdEf"
}
```

Add `"db:databaseName": "..."` **only** if `dbName` above was non-null.

Account/region are taken from your active AWS credentials automatically
(`CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`). Override with
`-c env:account=... -c env:region=...` if needed.

Also review the placeholder assumptions in `lib/database-stack.ts` marked
`DIVERGENCE` — `storageEncrypted`, `storageType`, `backupRetention`, and
`instanceType` all need confirming against the output above.

## Import the instance

```bash
npx cdk synth DatabaseStack          # must synth with a concrete env
npx cdk import DatabaseStack          # prompts for the DBInstanceIdentifier
npx cdk diff DatabaseStack
```

The template is a single `AWS::RDS::DBInstance`, so `cdk import` adopts it
directly. `cdk diff` afterwards **must be empty** — no added/removed
resources, no property changes.

Any diff means a context value is wrong. **Fix it — do not deploy.** A diff
on a create-only property (`DBName`, `MasterUsername`, engine version,
storage encryption, VPC/subnet group) means a deploy would **replace** the
instance.

Commit `cdk.context.json` (it caches the VPC lookup so teammates and CI
resolve the same subnets) and `cdk.json`.

## After a clean import

1. Set `deletionProtection: true` in `lib/database-stack.ts` and
   `npx cdk deploy` — zero-downtime, and it stops accidental drops.
2. Switch the credentials to `rds.Credentials.fromSecret(secret, username)`
   and `npx cdk deploy`. That adds the `AWS::SecretsManager::SecretTargetAttachment`
   that writes host/port/dbname into the secret for a future app stack to
   consume. Fine as a normal deploy — it just can't be present during
   `cdk import` (not an importable resource type).
3. Path B / Phase A2: introduce the dedicated VPC. Because an RDS instance
   cannot change VPC in place, this is snapshot → restore into the new VPC →
   repoint `DATABASE_URL` → retire the old instance.
