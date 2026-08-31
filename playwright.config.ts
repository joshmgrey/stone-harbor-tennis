import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. One happy path through the real app: admin login →
 * create a session → four players sign up → generate pairings.
 *
 * Needs a Postgres reachable at `DATABASE_URL` with migrations applied, and
 * `AUTH_SECRET` set to the admin password. CI (the `e2e` job in ci.yml)
 * builds the app and runs `npm run start`; locally, start your own
 * `npm run dev` and Playwright will reuse it.
 *
 * `next start` runs in production mode, where `src/lib/prisma.ts` enforces TLS
 * unless the URL opts out — a plain local/CI Postgres has no SSL, so the
 * fallback URL carries `?sslmode=disable`.
 */
const PORT = 3000;

// The spec and the app server must agree on AUTH_SECRET / DATABASE_URL. When
// Playwright reuses an already-running `npm run dev` (the local flow),
// `webServer.env` below is NOT applied to that server — it read `.env.local`.
// So pull `.env.local` into this process too, unless the ambient env already
// pinned the value (CI sets both on the job, on every side).
if (!process.env.CI) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // no .env.local (fresh clone) — fall through to the defaults below
  }
}

const AUTH_SECRET = process.env.AUTH_SECRET ?? "e2e-admin-secret";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/tennis?sslmode=disable";

// Make the resolved values visible to the spec (workers fork after this runs)
// and to a Playwright-managed server.
process.env.AUTH_SECRET = AUTH_SECRET;
process.env.DATABASE_URL = DATABASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { AUTH_SECRET, DATABASE_URL },
  },
});
