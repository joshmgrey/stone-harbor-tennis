#!/usr/bin/env node
// Migrator entry point: `prisma migrate deploy`, then sync the app role.
//
// In prod the owner connection is NOT stored as a URL. ECS injects the RDS
// master secret (`stone-harbor-tennis/rds/master`) as DB_MASTER_SECRET, JSON:
//
//   {"username":"postgres","password":"...","host":"...","port":5432, ...}
//
// That secret is also what DatabaseStack sets the instance's password from,
// so it is the ONLY copy of the master password; the URL is derived here.
// `host`/`port`/`engine` are merged in by the RDS SecretTargetAttachment;
// `dbname` is only present when the instance has one, hence the default.
//
// An explicit DATABASE_URL (local dev, CI) still wins.
import { spawnSync } from "node:child_process";

function ownerUrlFromSecret(raw) {
  let s;
  try {
    s = JSON.parse(raw);
  } catch {
    throw new Error("DB_MASTER_SECRET is not valid JSON");
  }
  for (const key of ["username", "password", "host"]) {
    if (!s[key]) throw new Error(`DB_MASTER_SECRET is missing "${key}"`);
  }
  const enc = encodeURIComponent;
  const port = s.port ?? 5432;
  const db = s.dbname ?? "postgres";
  return `postgresql://${enc(s.username)}:${enc(s.password)}@${s.host}:${port}/${enc(db)}`;
}

if (!process.env.DATABASE_URL) {
  if (!process.env.DB_MASTER_SECRET) {
    throw new Error("Set DATABASE_URL, or DB_MASTER_SECRET (the RDS master secret JSON)");
  }
  process.env.DATABASE_URL = ownerUrlFromSecret(process.env.DB_MASTER_SECRET);
}

const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
});
if (migrate.status !== 0) {
  process.exit(migrate.status ?? 1);
}

// Reads DATABASE_URL / APP_DATABASE_URL from process.env at import time.
await import("./sync-app-db-role.mjs");
