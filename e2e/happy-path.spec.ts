import { test, expect, type Page } from "@playwright/test";

/**
 * One full trip through the app against a real Postgres:
 *
 *   home page renders
 *     → admin logs in
 *     → admin creates a session
 *     → four players sign up on the public page
 *     → admin generates pairings and sees a full Court 1
 *
 * Exercises cookie auth, writes across sessions / players / signups, the
 * Fisher-Yates pairing endpoint, and SSR + client hydration on every page.
 */

// playwright.config.ts resolves this (from .env.local locally, the job env in
// CI) and pins it on process.env before workers fork, so the app server and
// this spec always use the same value.
const ADMIN_PASSWORD = process.env.AUTH_SECRET ?? "e2e-admin-secret";
const PLAYERS = ["Alice Ace", "Bob Baseline", "Carol Crosscourt", "Dave Dropshot"];

/** A date a week out, as YYYY-MM-DD, so the session counts as upcoming. */
function upcomingDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

async function logInAsAdmin(page: Page) {
  await page.goto("/admin");
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log In" }).click();
  await expect(
    page.getByRole("heading", { name: "Admin Dashboard" }),
  ).toBeVisible();
}

test("admin creates a session, players sign up, pairings generate", async ({
  page,
}) => {
  // 1. Home page is up.
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Stone Harbor Invitational Tennis" }),
  ).toBeVisible();

  // 2. Log in.
  await logInAsAdmin(page);

  // 3. Create a session (default 2 courts / 09:00–11:00 is fine).
  await page.getByRole("button", { name: "+ Create New Session" }).click();
  await page.locator('input[type="date"]').fill(upcomingDate());
  await page.getByRole("button", { name: "Create Session" }).click();

  const manage = page.getByRole("link", { name: "Manage" }).last();
  await expect(manage).toBeVisible();
  const href = await manage.getAttribute("href");
  expect(href).toMatch(/^\/admin\/sessions\/\d+$/);
  const sessionId = Number(href!.split("/").pop());

  // 4. Four players sign up on the public page.
  await page.goto(`/sessions/${sessionId}`);
  const nameField = page.locator('input[list="known-players"]');
  await expect(nameField).toBeVisible(); // past "Loading session…", form shown

  for (const [i, name] of PLAYERS.entries()) {
    await nameField.fill(name);
    await page.getByRole("button", { name: /Sign Me Up/ }).click();
    await expect(page.getByText(`You're signed up, ${name}`)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `Playing (${i + 1}/8)` }),
    ).toBeVisible();
  }

  // 5. Admin generates pairings.
  await page.goto(`/admin/sessions/${sessionId}`);
  const generate = page.getByRole("button", { name: /Generate Pairings/ });
  await expect(generate).toBeEnabled();
  await generate.click();

  await expect(page.getByText("Court 1")).toBeVisible();
  for (const name of PLAYERS) {
    // The name shows in both the roster and the Court 1 box.
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  // Exactly four players, one court, nobody sitting out.
  await expect(page.getByText("Court 2")).toHaveCount(0);
  await expect(page.getByText("Sitting out:")).toHaveCount(0);
});
