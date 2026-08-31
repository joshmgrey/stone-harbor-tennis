# Stone Harbor Invitational Tennis

A scheduling and signup site for a recreational doubles tennis league in Stone Harbor, NJ.

---

## Problem Statement

A small community tennis league needed a lightweight way to:

1. **Post upcoming sessions** (date, time, courts, capacity) so players know when to show up.
2. **Let players sign up** without creating accounts or remembering passwords — just name and phone.
3. **Generate random doubles pairings** on the day of play so the admin isn't doing it by hand on a whiteboard.
4. **Keep a roster** so returning players can find their name in a dropdown instead of re-typing it every time.
5. **Subscribe to a calendar feed** so sessions automatically appear in Google Calendar, Apple Calendar, or Outlook.

Previously this was managed over group text message. The goal was to replace that with a simple, mobile-friendly web page anyone can open from their phone.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **Framework** | Next.js 16 (App Router) | Server components handle auth-gated admin pages without client-side state; API routes replace a separate backend; one repo ships everything. |
| **Language** | TypeScript | Catches the shape mismatches between DB rows, API responses, and UI components early — especially useful when the schema changes (e.g. `email` → `phone`). |
| **Styling** | Tailwind CSS v4 | Utility-first keeps the CSS co-located with the markup, which matters in a project this small where a separate stylesheet would just be noise. |
| **ORM** | Prisma 7 | Type-safe queries with zero boilerplate SQL, auto-generated migrations, and a single schema file that doubles as documentation. |
| **Database (dev)** | PostgreSQL 17 (local) | Matches production exactly, so there are no "works on my machine" surprises with type casting, `ILIKE`, or `SERIAL` vs `AUTOINCREMENT`. |
| **Database (prod)** | AWS RDS PostgreSQL | Managed backups and automatic minor-version patching. Not publicly accessible — reachable only from the Fargate service's security group inside the VPC. |
| **Auth** | Cookie + SHA-256 hash | The only privileged user is a single admin. A full auth library (NextAuth, Clerk) would be heavy for one person with one password. |
| **Hosting** | AWS ECS Fargate + ALB | Runs the container in the same VPC as the database, so RDS can be private. CDK-defined ([`infra/`](infra/)); GitHub Actions builds the image and deploys on push to `main`. |

---

## Architecture Overview

```
Browser
  │
  ├── Public pages (server components)
  │     ├── / .............. session list (reads DB server-side)
  │     └── /sessions/[id] . signup form + pairing display (client component)
  │
  └── Admin pages (server components, cookie-gated)
        ├── /admin ......... login form or dashboard
        └── /admin/sessions/[id] ... manage signups, generate pairings

API Routes (Next.js route handlers)
  ├── GET  /api/sessions            list all sessions
  ├── POST /api/sessions            create session (admin only)
  ├── DELETE /api/sessions/[id]     delete session (admin only)
  ├── GET  /api/sessions/[id]/signups     list signups
  ├── POST /api/sessions/[id]/signups     sign up (upserts player roster)
  ├── DELETE /api/sessions/[id]/signups/[signupId]  remove signup (admin)
  ├── GET  /api/sessions/[id]/pairings    get pairings
  ├── POST /api/sessions/[id]/pairings    generate pairings (admin, Fisher-Yates shuffle)
  ├── GET  /api/players             player roster for autocomplete
  └── GET  /api/calendar            iCal feed for calendar subscription

Database (PostgreSQL)
  ├── sessions   – one row per scheduled court booking
  ├── signups    – many-to-one with sessions (cascades on delete); references players via player_id FK
  ├── pairings   – generated doubles assignments, replaced atomically each run
  └── players    – persistent roster, upserted on every signup; authoritative source for name and phone
```

**Pairing generation** uses a Fisher-Yates shuffle over the signup list, then groups into sets of four per court. Any remainder sits out. The entire operation (delete old pairings + insert new ones) runs in a single Prisma transaction so the court sheet is never in a half-replaced state.

**Auth** works by storing a SHA-256 hash of the admin password in a cookie at login. Every admin API route and the admin server component calls `isAdmin()`, which re-hashes `AUTH_SECRET` from the environment and compares — no session store, no database round-trip.

---

## Tradeoffs Considered

**SQLite vs PostgreSQL**
Started with SQLite + libSQL for zero-setup dev. Switched to PostgreSQL because the production target is AWS RDS, and running a different provider locally (even via a compatibility layer) risks subtle behavioral differences in migrations and queries. The cost is one extra setup step (`createdb tennis`) on a new machine.

**Prisma vs raw SQL**
Prisma adds a code-generation step and a non-trivial `node_modules` footprint. The payoff is typed query results everywhere — renaming a column in `schema.prisma` surfaces every broken reference as a TypeScript error before the app even runs. For a hobby project the tradeoff is worth it; for a latency-critical path it wouldn't be.

**Single admin password vs per-user roles**
A proper role system would let the league coordinator delegate to an assistant admin without sharing credentials. That wasn't a requirement here, and adding it would mean a users table, hashed passwords or OAuth, and session management — a lot of surface area for one person. Revisit if the league grows.

**No client-side caching / SWR**
The signup and pairing pages fetch on mount and after mutations with plain `fetch`. Adding SWR or React Query would give optimistic updates and background revalidation, but the UX requirement is simple enough that a full-page re-fetch after each action is imperceptible on a local network.

**Hosting: Fargate (was Amplify)**
The app first ran on AWS Amplify with a publicly-accessible RDS instance — Amplify's VPC support for SSR apps was too limited to reach a private database. It was later migrated to a container on ECS Fargate behind an ALB, in the same VPC as RDS, so the database could be closed off (`infra/README.md` has the phased story). App Runner would have been simpler but AWS closed it to new customers. Vercel stays off the table — no private VPC networking for RDS on the plans that matter. The cost is roughly $15/mo → $40/mo and a real deploy pipeline instead of git-push-and-forget.

---

## Local Development

### Prerequisites
- Node.js 24
- PostgreSQL 17 running locally

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create the database
psql -U postgres -c "CREATE DATABASE tennis;"

# 3. Copy environment variables and fill in the values
cp .env.local.example .env.local

# 4. Run migrations
npx prisma migrate dev

# 5. Start the dev server
npm run dev

# (optional) run the test suite — no database needed
npm test
```

Open [http://localhost:3000](http://localhost:3000).  
Admin panel is at [http://localhost:3000/admin](http://localhost:3000/admin).

### Environment Variables

| Variable | Description |
|---|---|
| `AUTH_SECRET` | Password for the admin panel |
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps Embed API key (optional — falls back to a plain Maps link) |

Example `.env.local`:
```
AUTH_SECRET=tennis123
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tennis
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...
```

---

## Continuous Integration

Every pull request runs typecheck, lint, the unit suite, the infra CDK tests,
and a Playwright end-to-end run before it can merge. `main` is branch-protected
so nothing lands red.

### Commands

| Command | |
|---|---|
| `npm test` | run the Vitest suite once |
| `npm run test:watch` | watch mode for local development |
| `npm run coverage` | suite + a V8 coverage report (`coverage/`, gitignored) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run e2e` | Playwright end-to-end tests (needs Postgres — see below) |

### What's tested

[Vitest](https://vitest.dev), no database required — Prisma and `isAdmin()` are
mocked at the module boundary.

| Area | File |
|---|---|
| Session capacity math | [`src/lib/session.test.ts`](src/lib/session.test.ts) |
| Admin token / cookie logic | [`src/lib/auth.test.ts`](src/lib/auth.test.ts) |
| Pairing algorithm (shuffle, court split, sit-outs) | [`src/lib/pairings.test.ts`](src/lib/pairings.test.ts) |
| `sessions` route handler | [`src/app/api/sessions/route.test.ts`](src/app/api/sessions/route.test.ts) |
| `pairings` route handler | [`src/app/api/sessions/[id]/pairings/route.test.ts`](src/app/api/sessions/[id]/pairings/route.test.ts) |

The Fisher-Yates shuffle and court-splitting logic lives in
[`src/lib/pairings.ts`](src/lib/pairings.ts) as pure, seedable functions so it
can be tested without a request or a database; the route handler just wires it
to Prisma.

### Infrastructure tests

[`infra/`](infra/) has its own Vitest suite (`cd infra && npm test`) of CDK
assertion tests — each stack is synthesized to a CloudFormation template and
checked against the properties that matter:

| Stack | Asserts, among other things |
|---|---|
| [`DatabaseStack`](infra/lib/database-stack.ts) | RDS instance is `PubliclyAccessible: false`, encrypted, deletion-protected, `RETAIN` on stack delete; its security group admits `5432` only from the app SG, never a CIDR |
| [`AppStack`](infra/lib/app-stack.ts) | one Fargate task, circuit-breaker rollback, ALB HTTPS + HTTP→HTTPS redirect, `/api/health` target-group check, a separate migrator task running `prisma migrate deploy`, the outputs `migrate.yml` reads |
| [`GitHubDeployStack`](infra/lib/github-deploy-stack.ts) | OIDC trust is scoped to this repo's `main` ref and `production` environment; the role can only assume the CDK bootstrap roles and read `stone-harbor-tennis/*` secrets |

No AWS credentials — VPC lookups resolve to a dummy VPC and the Docker image
asset is fingerprinted, not built.

### End-to-end tests

[`e2e/`](e2e/) has a [Playwright](https://playwright.dev) suite that drives a
real browser through one full happy path against a real Postgres:

> home page renders → admin logs in → admin creates a session → four players
> sign up on the public page → admin generates pairings and sees a full Court 1

It exercises cookie auth, writes across the `sessions` / `players` / `signups`
tables, the Fisher-Yates pairing endpoint, and SSR + client hydration on every
page — the integration the mocked unit tests can't cover.

```bash
# .env.local needs DATABASE_URL (migrations applied) and AUTH_SECRET —
# playwright.config.ts reads .env.local so the spec and the dev server agree.
npx playwright install chromium   # one-time
npm run dev                       # in one terminal
npm run e2e                       # in another — reuses the running dev server
```

In CI the `e2e` job starts a `postgres:17` service container, runs
`prisma migrate deploy`, `npm run build`, then `npm run start` (via Playwright's
`webServer`) and the suite against it; the job env sets `DATABASE_URL` and
`AUTH_SECRET` on every side. The HTML report is uploaded as an artifact.

### Pipeline

| Workflow | Trigger | Does |
|---|---|---|
| [`ci.yml`](.github/workflows/ci.yml) | every PR + push to `main` | `typecheck` / `lint` / `test` matrix, an `infra` job (CDK assertion tests), an `e2e` job (Playwright against a Postgres service container), and a `coverage` job that uploads its report as an artifact |
| [`docker-build.yml`](.github/workflows/docker-build.yml) | PRs touching the image, deps, or `src/` | builds the runner + migrator images and smoke-tests `GET /api/health` against the running container |
| [`deploy.yml`](.github/workflows/deploy.yml) | push to `main` | `cdk deploy AppStack` (see [Deployment](#deployment-aws)), then a post-deploy smoke test that polls the live domain — `/api/health` (body checked), `/api/sessions` (exercises RDS), and `/` (SSR) — and fails the run if the site isn't serving |
| [`migrate.yml`](.github/workflows/migrate.yml) | manual | `prisma migrate deploy` as a one-off Fargate task |

A full run of `deploy.yml` on `main` has gone green end to end: `cdk deploy
AppStack` updated the ECS service, and the post-deploy smoke test then reached
the live domain from outside AWS —

```
smoke-testing https://stone-harbor-invitational-tennis.org
ok    /api/health -> 200
ok    /api/sessions -> 200
ok    / -> 200
smoke test passed
```

confirming DNS → ALB → task → RDS and Next SSR are all serving the new revision.

### Branch protection

`main` requires these status checks to pass before merge: `check (typecheck)`,
`check (lint)`, `check (test)`, `infra`, `e2e`, `coverage`. `build` is
intentionally **not** required — it's path-filtered, so on PRs that don't touch
app code it never runs and a required-but-absent check would block the merge
forever.

The gate has been verified from both sides with throwaway PRs:

- A PR whose checks were still pending reported `mergeStateStatus: BLOCKED`,
  and `gh pr merge` was refused with *"the base branch policy prohibits the
  merge"*. Once all required checks passed it went `CLEAN`.
- A PR that flipped `multiAz` to `true` in `DatabaseStack` — a change one of
  the CDK assertion tests guards — failed the `infra` check and stayed
  `BLOCKED`; reverting the change cleared the check and unblocked the PR.

---

## Deployment (AWS)

All infrastructure is AWS CDK in [`infra/`](infra/) — see [`infra/README.md`](infra/README.md)
for the full picture and how it got here (it started on Amplify + a public RDS
instance and was migrated).

### Shape

```
Route 53 (apex, www, new.) ─▶ ALB (HTTPS, ACM) ─▶ Fargate service ─▶ RDS PostgreSQL 17
                                                   (default VPC)      (private, SG-scoped)
```

- **`DatabaseStack`** — the RDS instance (adopted via `cdk import`), `publiclyAccessible: false`, security group admits `5432` only from the Fargate service. Deployed from a laptop.
- **`AppStack`** — ECR image, ECS Fargate service behind an ALB, ACM cert, Route 53 records, and a one-off migrator task. Deployed by CI.
- **`GitHubDeployStack`** — GitHub OIDC provider + the role CI assumes (no stored AWS keys).

### Runtime config

Secrets Manager, injected into the container by ECS (never in the task definition):

| Secret | |
|---|---|
| `stone-harbor-tennis/app/database-url` | full `postgresql://…` connection string |
| `stone-harbor-tennis/app/auth-secret` | the admin password (`AUTH_SECRET`) |

`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is a **build arg** (inlined into the client bundle at image build time), supplied from the `GOOGLE_MAPS_API_KEY` GitHub Actions secret.

### Deploying

- **App**: push to `main` → `.github/workflows/deploy.yml` builds the image, runs `cdk deploy AppStack`, then smoke-tests the live domain (`/api/health`, `/api/sessions`, `/`) and fails the run if the new revision isn't serving.
- **Migrations**: **Actions → migrate → Run workflow** — runs `prisma migrate deploy` as a one-off Fargate task in the VPC (the DB isn't reachable from outside it).
- **Database changes**: `cd infra && npx cdk deploy DatabaseStack` from a machine with AWS credentials.
