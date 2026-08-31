import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: getCookie }),
}));

// Import after the mock is registered.
import { adminToken, cookieName, isAdmin } from "./auth";

const expectedToken = (secret: string) =>
  createHash("sha256")
    .update("stone_harbor_tennis:" + secret)
    .digest("hex");

describe("auth", () => {
  beforeEach(() => {
    getCookie.mockReset();
    vi.stubEnv("AUTH_SECRET", "s3cret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cookieName is stable", () => {
    expect(cookieName()).toBe("stone_harbor_tennis_auth");
  });

  it("adminToken hashes the configured secret", () => {
    expect(adminToken()).toBe(expectedToken("s3cret"));
  });

  it("isAdmin is true when the cookie matches the token", async () => {
    getCookie.mockReturnValue({ value: expectedToken("s3cret") });
    expect(await isAdmin()).toBe(true);
  });

  it("isAdmin is false when the cookie value is wrong", async () => {
    getCookie.mockReturnValue({ value: "nope" });
    expect(await isAdmin()).toBe(false);
  });

  it("isAdmin is false when the cookie is absent", async () => {
    getCookie.mockReturnValue(undefined);
    expect(await isAdmin()).toBe(false);
  });

  it("isAdmin is false when a stale cookie no longer matches a rotated secret", async () => {
    getCookie.mockReturnValue({ value: expectedToken("old-secret") });
    expect(await isAdmin()).toBe(false);
  });
});
