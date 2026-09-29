#!/usr/bin/env node
// Create/refresh the app's least-privilege Postgres role.
//
// Runs as the owner (DATABASE_URL — the master user, same one `prisma migrate
// deploy` uses) right after migrations, and makes the database match
// APP_DATABASE_URL:
//
//   - the role named in APP_DATABASE_URL exists and can log in,
//   - its password is the one in APP_DATABASE_URL (so that secret is the
//     ONLY copy — rotating it is: edit the secret, run migrate, redeploy),
//   - it has DML on the app's tables and nothing else: no DDL, no role
//     management, no access to `_prisma_migrations`.
//
// Idempotent; safe to run on every migrate. A no-op when APP_DATABASE_URL is
// unset, so environments without the split keep working.
import pg from "pg";

const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;

if (!appUrl) {
  console.log("APP_DATABASE_URL not set; skipping app role sync");
  process.exit(0);
}
if (!ownerUrl) {
  throw new Error("DATABASE_URL (the owner connection) is required");
}

const owner = new URL(ownerUrl);
const app = new URL(appUrl);
const role = decodeURIComponent(app.username);
const password = decodeURIComponent(app.password);

// Guard against a mis-pasted secret before touching anything.
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
  throw new Error(`APP_DATABASE_URL user "${role}" is not a plain lowercase role name`);
}
if (role === decodeURIComponent(owner.username)) {
  throw new Error("APP_DATABASE_URL must use a different user than DATABASE_URL");
}
if (password.length < 16) {
  throw new Error("APP_DATABASE_URL password must be at least 16 characters");
}
if (app.host !== owner.host || app.pathname !== owner.pathname) {
  throw new Error("APP_DATABASE_URL must point at the same host and database as DATABASE_URL");
}

// Same TLS rule as src/lib/prisma.ts.
const ssl =
  /[?&]sslmode=disable/.test(ownerUrl) || process.env.NODE_ENV !== "production"
    ? undefined
    : { rejectUnauthorized: false };

const client = new pg.Client({ connectionString: ownerUrl, ssl });
await client.connect();

try {
  const r = client.escapeIdentifier(role);
  const dml = "SELECT, INSERT, UPDATE, DELETE";

  await client.query("BEGIN");

  const { rowCount } = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname = $1",
    [role],
  );
  // DDL can't take bind parameters; escapeLiteral quotes the password.
  const pw = client.escapeLiteral(password);
  await client.query(
    rowCount
      ? `ALTER ROLE ${r} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${pw}`
      : `CREATE ROLE ${r} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${pw}`,
  );

  const { rows } = await client.query("SELECT current_database() AS db");
  await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(rows[0].db)} TO ${r}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
  await client.query(`GRANT ${dml} ON ALL TABLES IN SCHEMA public TO ${r}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`);
  // Migration bookkeeping is the owner's business only.
  await client.query(
    `DO $$ BEGIN
       IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
         EXECUTE 'REVOKE ALL ON TABLE public._prisma_migrations FROM ${r.replaceAll("'", "''")}';
       END IF;
     END $$`,
  );
  // Tables/sequences that future migrations create (as this owner) get the
  // same grants automatically, even before the next sync runs.
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ${dml} ON TABLES TO ${r}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${r}`,
  );

  await client.query("COMMIT");
  console.log(`app role "${role}" ${rowCount ? "updated" : "created"}; grants applied`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  await client.end();
}
