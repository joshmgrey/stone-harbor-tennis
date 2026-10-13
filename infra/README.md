# infra — AWS CDK

Infrastructure-as-code for Stone Harbor Invitational Tennis.

**Status: Path B complete.** The app runs on ECS Fargate behind an ALB, the
RDS PostgreSQL 17 instance is private (reachable only from the Fargate
service's security group), and Amplify is gone.

| Stack | What it is | Deployed from |
|---|---|---|
| `DatabaseStack` | the RDS instance (adopted via `cdk import`) + its SG, admitting `5432` only from the app SG | laptop |
| `GitHubDeployStack` | GitHub OIDC provider + the role CI assumes | laptop (rarely) |
| `AppStack` | ECR image, Fargate service, ALB, ACM cert, Route 53 records, migrator task | CI (`deploy.yml`) |

Day-to-day operations: [migrations](#migrations-from-here-on),
[database credentials](#database-credentials-one-secret-per-password) (incl.
password rotation). Everything from [Path A](#path-a--adopt-the-rds-instance-history)
through [B5](#b5--decommission) below is the record of **how it got here**:
the instance was originally manually provisioned and public, adopted into
CDK unchanged (Path A), then moved behind Fargate and made private (Path B).
Those steps are done; keep them for reference or a rebuild.

## Layout

```
infra/
├── bin/infra.ts                 CDK app entrypoint; wires context -> stacks
├── lib/database-stack.ts        RDS instance (described for import) + its SG
├── lib/app-stack.ts             Fargate service, ALB, DNS, migrator task
├── lib/github-deploy-stack.ts   OIDC provider + CI deploy role
├── test/*.test.ts               CDK assertion tests (`npm test`)
├── cdk.json                     app command + feature flags (committed)
├── cdk.context.json             db:* / env:* values + VPC lookup cache (GITIGNORED)
├── vitest.config.mts
└── tsconfig.json
```

Each stack is only in the tree when its context is present: `DatabaseStack`
needs `db:instanceIdentifier`, `AppStack` needs `app:appDatabaseUrlSecretArn`
(CI passes every `app:*` value from repo variables), `GitHubDeployStack` is
always there.

## Context is gitignored

This repo is **public**. `cdk.context.json` holds the AWS account id, VPC /
subnet / security-group ids, the KMS key ARN, the secret ARN and the resolved
subnet layout — a map of the environment. It is **not committed**. Keep your
values there locally, or pass them with `-c key=value`. CI / another machine
re-derives the lookup cache from AWS credentials and re-supplies `db:*`.

`infra/cdk.context.json` (create if missing — all values are placeholders
here on purpose; fill from the RDS console / the query below).
`db:appSecurityGroupId` is the Fargate service's security group, the
`ServiceSecurityGroupId` output of `AppStack`:

```json
{
  "env:account": "<account id>",
  "env:region": "us-east-2",
  "db:instanceIdentifier": "tennis",
  "db:engineVersion": "17.9",
  "db:allocatedStorageGib": "20",
  "db:vpcId": "vpc-XXXXXXXX",
  "db:subnetGroupName": "default-vpc-XXXXXXXX",
  "db:appSecurityGroupId": "sg-XXXXXXXX",
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

`DatabaseStack` doesn't need `cdk bootstrap` (the account is bootstrapped
anyway, for `AppStack` — see [B0](#b0--bootstrap--deploy-role)). It uses
`CliCredentialsStackSynthesizer` (see `bin/infra.ts`) — every CloudFormation
call runs with your CLI credentials, no bootstrap roles or staging bucket.
`cdk import` rejects the bootstrap exec role (`RoleArn`) and stack tags, so
the stack carries neither.

---

# Path A — adopt the RDS instance (history)

Done. The instance was manually provisioned and public; these steps adopted
it into `DatabaseStack` with an **empty diff** (the template was then a
single `AWS::RDS::DBInstance`, so nothing non-importable could block the
import) and changed nothing about it. Making it private came later, in
[B4](#b4--database-private).

## Create the credentials secret

The password was the one in the Amplify app's `DATABASE_URL` at the time:

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

# Path B — app off Amplify, database private (history)

Done: B0–B5 below all ran. The [migrations](#migrations-from-here-on)
subsection under B4 and the
[database credentials](#database-credentials-one-secret-per-password) section
after B5 are the current runbooks.

| Stack | Deploy from | Notes |
|---|---|---|
| `GitHubDeployStack` | laptop (once) | OIDC provider + `cdk deploy` role for CI |
| `AppStack` | CI only | Docker image asset; only in the tree when `app:appDatabaseUrlSecretArn` is set |

## B0 — bootstrap + deploy role

```bash
cd infra
npx cdk bootstrap aws://<account id>/us-east-2
npx cdk deploy GitHubDeployStack
```

Note the `DeployRoleArn` output.

## B2 — Fargate app

### 1. Secrets (once)

```bash
aws secretsmanager create-secret --region us-east-2 \
  --name stone-harbor-tennis/app/auth-secret \
  --secret-string '<the admin password (then in Amplify)>'

# The app's least-privilege role (letters-and-digits password: no URL encoding).
aws secretsmanager create-secret --region us-east-2 \
  --name stone-harbor-tennis/app/app-database-url \
  --secret-string 'postgresql://tennis_app:<PW>@tennis.<...>.us-east-2.rds.amazonaws.com:5432/postgres'
```

The master credentials are **not** duplicated here: the migrator reads the
`stone-harbor-tennis/rds/master` secret from Path A directly (see
[Database credentials](#database-credentials-one-secret-per-password)).

### 2. GitHub repo config

**Settings → Secrets and variables → Actions**

Variables:

| Name | Value |
|---|---|
| `AWS_ACCOUNT_ID` | `<account id>` |
| `AWS_DEPLOY_ROLE_ARN` | the `DeployRoleArn` from B0 |
| `VPC_ID` | `vpc-XXXXXXXX` (the default VPC) |
| `HOSTED_ZONE_ID` | `<hosted zone id>` (Route 53 → Hosted zones) |
| `ZONE_NAME` | `stone-harbor-invitational-tennis.org` |
| `DB_MASTER_SECRET_ARN` | full ARN of `stone-harbor-tennis/rds/master` (Path A) |
| `APP_DATABASE_URL_SECRET_ARN` | ARN of `app-database-url` from step 1 |
| `AUTH_SECRET_ARN` | ARN from step 1 |

Secret:

| Name | Value |
|---|---|
| `GOOGLE_MAPS_API_KEY` | the `NEXT_PUBLIC_` Maps key |

### 3. Deploy

Merging B2 to `main` ran `.github/workflows/deploy.yml`, which at the time
did `prisma migrate deploy` (DB still public) → `cdk deploy AppStack` (builds
the image, creates the ALB + service). Today `deploy.yml` is `cdk deploy
AppStack` + a smoke test only; migrations moved to `migrate.yml` in
[B4](#b4--database-private).

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
aws route53 list-resource-record-sets --hosted-zone-id <hosted zone id> \
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
   (`sg-XXXXXXXX`, the `ServiceSecurityGroupId` output). Approve the
   security prompt. This is an **online modify** — a few seconds' connection
   reset, no replacement. Prisma reconnects.
4. Verify the site still loads. The RDS DNS name now resolves to the private
   IP (from in-VPC); the app reaches it through the SG.

`db:securityGroupId` (the old `0.0.0.0/0` SG) is no
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
   points at Amplify's CloudFront distribution (`<id>.cloudfront.net`), which is
   about to disappear). apex / www / new. are all explicit records and
   unaffected.
2. **Amplify app** — Amplify console → the app → **App settings → General →
   Delete app**. Then immediately re-check apex + www:
   `curl -sI https://stone-harbor-invitational-tennis.org` should still be
   200. If Amplify's teardown removed either record, run
   `cdk deploy AppStack` — `deleteExisting` recreates them.
3. **Old RDS security group** — delete it (the old
   `0.0.0.0/0` one). It's been unattached since B4.
4. **Stale ACM validation CNAMEs** — Route 53 may still have `_...acm-validations`
   records for Amplify's old cert. Harmless; delete for tidiness.
5. Code: `amplify.yml` is removed; the main README deployment section is
   rewritten. `db:securityGroupId` context is dead — drop it from
   `cdk.context.json`.

Path B complete. The database is private, the app is on Fargate, and there
is no Amplify.

## Database credentials: one secret per password

The app connects as its own role, `tennis_app`, not the RDS master user. It
can only read and write rows (`SELECT/INSERT/UPDATE/DELETE`): no DDL, no role
management, no access to `_prisma_migrations`. Migrations run as the master
user.

Each password lives in exactly **one** secret:

| Secret | Holds | Used by |
|---|---|---|
| `stone-harbor-tennis/rds/master` | master (`postgres`) creds as JSON (`username`, `password`, `host`, `port`, …) | DatabaseStack sets the instance password from it; the migrator |
| `stone-harbor-tennis/app/app-database-url` | `postgresql://tennis_app:…` URL | the service; the migrator (to sync the role) |

The migrator task runs [`scripts/migrate.mjs`](../scripts/migrate.mjs): it
builds the owner URL from the `rds/master` JSON, runs `prisma migrate deploy`,
then runs [`scripts/sync-app-db-role.mjs`](../scripts/sync-app-db-role.mjs),
which creates `tennis_app` if needed, sets its password from
`app-database-url`, and reapplies the grants. Both are idempotent.

GitHub variables: `DB_MASTER_SECRET_ARN` (the full ARN of `rds/master`) and
`APP_DATABASE_URL_SECRET_ARN`.

### Setting it up from scratch

1. **Create the secret** (B2 step 1 covers this too). Use a letters-and-digits password, so it needs no
   URL encoding. Same host and database as the RDS instance:

   ```bash
   aws secretsmanager create-secret --region us-east-2 \
     --name stone-harbor-tennis/app/app-database-url \
     --secret-string 'postgresql://tennis_app:<PW>@tennis.<...>.us-east-2.rds.amazonaws.com:5432/postgres'
   ```

   Add its ARN as the GitHub variable **`APP_DATABASE_URL_SECRET_ARN`**.
2. **Deploy, then create the role.** The service connects as `tennis_app`
   from its first deploy, but the role only exists once **migrate** has run,
   so DB-backed pages 500 (and the deploy's smoke test goes red) until then.
   Run Actions → **deploy**, then Actions → **migrate**. The migrate task's
   log should end with `app role "tennis_app" created; grants applied`. The
   running task already has the right URL, so it recovers on its next
   connection; no redeploy needed. That first deploy run stays red.

   (The live site was moved over without that gap: the role was created
   first, and the service switched in a later PR.)

### Rotating the app password

Edit `app-database-url` → run **migrate** (it sets the new password on the
role) → force a new ECS deployment (the service reads secrets only when a
task starts). The site returns 500s between the migrate run and the new task
coming up, so do it at a quiet time.

### Rotating the master password

Keep the instance's "Manage master credentials in AWS Secrets Manager" **off**
(RDS auto-rotation silently broke the site in Sep 2026). Then: RDS → Modify →
new password → Apply immediately; put the same password in `rds/master`'s
`password` field. The live site isn't affected (it uses `tennis_app`); run
**migrate** to confirm the migrator can still connect.
