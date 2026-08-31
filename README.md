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

- **App**: push to `main` → `.github/workflows/deploy.yml` builds the image and runs `cdk deploy AppStack`.
- **Migrations**: **Actions → migrate → Run workflow** — runs `prisma migrate deploy` as a one-off Fargate task in the VPC (the DB isn't reachable from outside it).
- **Database changes**: `cd infra && npx cdk deploy DatabaseStack` from a machine with AWS credentials.

<!-- branch-protection verification: safe to delete -->
