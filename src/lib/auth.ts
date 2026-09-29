import { cookies } from "next/headers";
import { createHash } from "crypto";

const COOKIE_NAME = "stone_harbor_tennis_auth";

function tokenFor(password: string): string {
  return createHash("sha256").update("stone_harbor_tennis:" + password).digest("hex");
}

export async function isAdmin(): Promise<boolean> {
  // Read cookies FIRST, unconditionally: calling cookies() is what makes the
  // pages that use isAdmin() (e.g. /admin) render per request. Returning
  // before it would let `next build` (which runs without AUTH_SECRET)
  // prerender them as static.
  const store = await cookies();
  const secret = process.env.AUTH_SECRET;
  // Fail closed. Without a secret the token would be the hash of "", which
  // anyone reading this (public) repo could compute and send as a cookie.
  if (!secret) return false;
  return store.get(COOKIE_NAME)?.value === tokenFor(secret);
}

export function cookieName(): string {
  return COOKIE_NAME;
}

export function adminToken(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return tokenFor(secret);
}
