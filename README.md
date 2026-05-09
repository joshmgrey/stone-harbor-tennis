# Stone Harbor Invitational Tennis (SHIT League)

A scheduling and signup site for a recreational doubles tennis league in Stone Harbor, NJ.

---

## Problem Statement

A small community tennis league needed a lightweight way to:

1. **Post upcoming sessions** (date, time, courts, capacity) so players know when to show up.
2. **Let players sign up** without creating accounts or remembering passwords — just name and phone.
3. **Generate random doubles pairings** on the day of play so the admin isn't doing it by hand on a whiteboard.
4. **Keep a roster** so returning players can find their name in a dropdown instead of re-typing it every time.

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
| **Database (prod)** | AWS RDS PostgreSQL | Managed backups, automatic minor-version patching, and Multi-AZ failover if needed — more reliable than self-managing Postgres on EC2. |
| **Auth** | Cookie + SHA-256 hash | The only privileged user is a single admin. A full auth library (NextAuth, Clerk) would be heavy for one person with one password. |
| **Hosting** | AWS Amplify | Git-connected deployments (push to main → live), built-in CI/CD, and managed environment variables — no server to maintain. |

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
  └── GET  /api/players             player roster for autocomplete

Database (PostgreSQL)
  ├── sessions   – one row per scheduled court booking
  ├── signups    – many-to-one with sessions (cascades on delete); references players via player_id FK
  ├── pairings   – generated doubles assignments, replaced atomically each run
  └── players    – persistent roster, upserted on every signup; authoritative source for name and phone
```

**Pairing generation** uses a Fisher-Yates shuffle over the signup list, then groups into sets of four per court. Any remainder sits out. The entire operation (delete old pairings + insert new ones) runs in a single Prisma transaction so the court sheet is never in a half-replaced state.

**Auth** works by storing a SHA-256 hash of the admin password in a cookie at login. Every admin API route and the admin server component calls `isAdmin()`, which re-hashes `ADMIN_PASSWORD` from the environment and compares — no session store, no database round-trip.

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

**AWS Amplify vs EC2 vs Vercel**
Vercel is the obvious choice for Next.js but its free tier doesn't support private VPC networking, which is needed to connect to RDS without exposing the database to the public internet. EC2 solves that but requires managing the OS, Node process, and deploys manually. Amplify sits in between — git-connected CI/CD and managed environment variables like Vercel, but running inside AWS where it can reach RDS over a private connection. The tradeoff is a less mature Next.js runtime than Vercel and a slightly more involved initial setup.

---

## Local Development

### Prerequisites
- Node.js 20+
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
| `ADMIN_PASSWORD` | Password for the admin panel |
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps Embed API key (optional — falls back to a plain Maps link) |

Example `.env.local`:
```
ADMIN_PASSWORD=tennis123
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tennis
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...
```

---

## Deployment (AWS)

### Infrastructure
- **AWS Amplify** — hosts the Next.js app, connected to the GitHub repo for automatic deploys on push to `main`
- **AWS RDS** — PostgreSQL 17 in a private subnet, reachable from Amplify over a VPC connection

### Steps

1. **RDS** — create a PostgreSQL 17 instance in a private subnet. Note the endpoint.
2. **Amplify** — connect the GitHub repo in the Amplify console, select the `main` branch.
3. **Environment variables** — in Amplify → App settings → Environment variables, add:
   ```
   DATABASE_URL=postgresql://user:pass@your-rds-endpoint:5432/tennis
   ADMIN_PASSWORD=a-strong-password
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...
   ```
4. **VPC** — in Amplify → App settings → VPC settings, attach the same VPC and private subnets as your RDS instance so Amplify can reach it privately.
5. **Migrate** — after the first deploy, run migrations against the production DB:
   ```bash
   DATABASE_URL=<prod-url> npx prisma migrate deploy
   ```
6. **Security group** — RDS inbound: allow port 5432 from the Amplify VPC security group only.
