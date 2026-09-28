import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  cookieName: () => "stone_harbor_tennis_auth",
  adminToken: () => "token-abc",
}));

import { POST, DELETE } from "./route";

const jsonRequest = (body: unknown) =>
  new Request("http://localhost/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "s3cret");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth", () => {
  it("rejects a wrong password with 401 and sets no cookie", async () => {
    const res = await POST(jsonRequest({ password: "nope" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid password" });
    expect(res.cookies.get("stone_harbor_tennis_auth")).toBeUndefined();
  });

  it("sets an httpOnly admin cookie for the correct password", async () => {
    const res = await POST(jsonRequest({ password: "s3cret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const cookie = res.cookies.get("stone_harbor_tennis_auth");
    expect(cookie?.value).toBe("token-abc");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 7);
  });
});

describe("DELETE /api/auth", () => {
  it("clears the admin cookie", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // A deletion is emitted as an expired cookie.
    expect(res.cookies.get("stone_harbor_tennis_auth")?.value).toBe("");
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0|Expires=/i);
  });
});
