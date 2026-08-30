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

**Secret attachment — done.** Credentials use `rds.Credentials.fromSecret`,
which adds `AWS::SecretsManager::SecretTargetAttachment` (a plain `cdk
deploy`, no instance change). The secret now also carries `host` / `port` /
`dbname` / `engine`.

---

# Path B — app off Amplify, database private

Stacks beyond `DatabaseStack`:

| Stack | Deploy from | Notes |
|---|---|---|
| `GitHubDeployStack` | laptop (once) | OIDC provider + `cdk deploy` role for CI |
| `AppStack` | CI only | Docker image asset; only in the tree when `app:domainName` is set |

## B0 — bootstrap + deploy role

```bash
cd infra
npx cdk bootstrap aws://462096274792/us-east-2
npx cdk deploy GitHubDeployStack
```

Note the `DeployRoleArn` output.

## B2 — Fargate app

### 1. Two secrets (once)

```bash
aws secretsmanager create-secret --region us-east-2 \
  --name stone-harbor-tennis/app/auth-secret \
  --secret-string '<the admin password currently in Amplify>'

aws secretsmanager create-secret --region us-east-2 \
  --name stone-harbor-tennis/app/database-url \
  --secret-string 'postgresql://postgres:<PW>@tennis.<...>.us-east-2.rds.amazonaws.com:5432/postgres'
```

### 2. GitHub repo config

**Settings → Secrets and variables → Actions**

Variables:

| Name | Value |
|---|---|
| `AWS_ACCOUNT_ID` | `462096274792` |
| `AWS_DEPLOY_ROLE_ARN` | the `DeployRoleArn` from B0 |
| `VPC_ID` | `vpc-01ae611b3b789af52` (the default VPC) |
| `HOSTED_ZONE_ID` | `Z0122083131AK1IA1P4HI` |
| `ZONE_NAME` | `stone-harbor-invitational-tennis.org` |
| `DATABASE_URL_SECRET_ARN` | ARN from step 1 |
| `AUTH_SECRET_ARN` | ARN from step 1 |

Secret:

| Name | Value |
|---|---|
| `GOOGLE_MAPS_API_KEY` | the `NEXT_PUBLIC_` Maps key |

### 3. Deploy

Merging B2 to `main` runs `.github/workflows/deploy.yml`: `prisma migrate
deploy` (DB still public) → `cdk deploy AppStack` (builds the image, creates
the ALB + service). Or trigger it manually with **Run workflow**.

The ACM cert (DNS-validated) covers the apex, `www.`, **and**
`new.<ZONE_NAME>`. Only `new.<ZONE_NAME>` gets a Route 53 record now — that's
the B2/B3 test URL. Verify the whole app at
`https://new.stone-harbor-invitational-tennis.org`: admin login, sign-ups,
pairings, calendar feed. It's talking to the **same** database as the live
Amplify site.

`AppStack` deploys from CI only — the image is a Docker asset and needs
Docker. `cdk synth`/`diff` for it work anywhere.

## B3 — cut users over

`AppStack` points apex + `www.` at the ALB. `deleteExisting: true` removes
Amplify's record for each name right before creating the new one (a custom
resource) — the gap is seconds.

`deleteExisting` only matches the **same record type**. Amplify's apex is an
A-alias (→ new A-alias, fine). Its `www` is a **CNAME** to the CloudFront
distribution, so `www` here is also a CNAME (→ the ALB's DNS name) — an
A-record at `www` would collide with the CNAME and the deploy would half-
apply (apex swapped, `www` fails, rollback deletes the new apex and leaves
the apex with no record).

**Before merging B3**, note the current targets so you can roll back:

```bash
aws route53 list-resource-record-sets --hosted-zone-id Z0122083131AK1IA1P4HI \
  --query "ResourceRecordSets[?Name=='stone-harbor-invitational-tennis.org.' || Name=='www.stone-harbor-invitational-tennis.org.']"
```

Merging B3 → `deploy.yml` runs → the cutover happens. Amplify stays deployed
and serving; rollback is recreating those two records against the Amplify
target from the output above.

## B4 — database private

Order after merging:

1. **`cdk deploy GitHubDeployStack`** (laptop) — the role gains `ecs:RunTask`
   / `iam:PassRole` for the migrator task. Approve the IAM prompt.
2. `deploy.yml` runs on the merge → `AppStack` gains the **migrator task
   definition** and its outputs. (No migrate step in `deploy.yml` any more.)
3. **`cdk deploy DatabaseStack`** (laptop) — `publiclyAccessible: false` +
   a CDK-managed SG admitting 5432 only from `db:appSecurityGroupId`
   (`sg-0827a63415fdba069`, the `ServiceSecurityGroupId` output). Approve the
   security prompt. This is an **online modify** — a few seconds' connection
   reset, no replacement. Prisma reconnects.
4. Verify the site still loads. The RDS DNS name now resolves to the private
   IP (from in-VPC); the app reaches it through the SG.

`db:securityGroupId` (the old `0.0.0.0/0` SG, `sg-00ad52e709e351b65`) is no
longer used — B5 deletes it.

### Migrations, from here on

`.github/workflows/migrate.yml` (**Actions → migrate → Run workflow**) runs
`prisma migrate deploy` as a one-off Fargate task in the VPC.

**`migrate.yml` uses the migrator task definition from AppStack's current
outputs** — i.e. the image from the last completed `cdk deploy`. So:

- **Run it only AFTER `deploy.yml` for that commit has finished.** Run it
  during the deploy and it runs the *old* migrator image → "no pending
  migrations" → nothing happens.
- **If new code depends on the new column, split the change into two PRs:**
  1. PR A — the migration only (`schema.prisma` + `prisma/migrations/...`).
     Merge → wait for `deploy.yml` → run `migrate.yml`. The running app
     selects explicit columns, so an added column is invisible to it — no
     errors during the gap.
  2. PR B — the code that uses the new column. Merge → deploy.

  Ship both together and there's a window (~10 min) where the new app is
  live but the migration hasn't run and DB pages 500.

Your laptop can't reach the DB directly; for `psql` / `prisma studio` you'd
tunnel through a bastion (not set up — add if you need it).

## B5 — decommission

Only once the Fargate app has been stable for a week or two.

1. **`*` wildcard record** — Route 53 → the zone → delete the `*` record (it
   points at Amplify's CloudFront `d2dqxtu5y326f4.cloudfront.net`, which is
   about to disappear). apex / www / new. are all explicit records and
   unaffected.
2. **Amplify app** — Amplify console → the app → **App settings → General →
   Delete app**. Then immediately re-check apex + www:
   `curl -sI https://stone-harbor-invitational-tennis.org` should still be
   200. If Amplify's teardown removed either record, run
   `cdk deploy AppStack` — `deleteExisting` recreates them.
3. **Old RDS security group** — delete `sg-00ad52e709e351b65` (the old
   `0.0.0.0/0` one). It's been unattached since B4.
4. **Stale ACM validation CNAMEs** — Route 53 may still have `_...acm-validations`
   records for Amplify's old cert. Harmless; delete for tidiness.
5. Code: `amplify.yml` is removed; the main README deployment section is
   rewritten. `db:securityGroupId` context is dead — drop it from
   `cdk.context.json`.

Path B complete. The database is private, the app is on Fargate, and there
is no Amplify.
