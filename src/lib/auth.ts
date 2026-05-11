import { cookies } from "next/headers";
import { createHash } from "crypto";

const COOKIE_NAME = "stone_harbor_tennis_auth";

function tokenFor(password: string): string {
  return createHash("sha256").update("stone_harbor_tennis:" + password).digest("hex");
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  const cookie = store.get(COOKIE_NAME);
  const expected = tokenFor(process.env.AUTH_SECRET ?? "");
  return cookie?.value === expected;
}

export function cookieName(): string {
  return COOKIE_NAME;
}

export function adminToken(): string {
  return tokenFor(process.env.AUTH_SECRET ?? "");
}
