import { describe, expect, it } from "vitest";
import { adminToken, cookieName } from "./auth";

describe("auth helpers", () => {
  it("uses a professional cookie name", () => {
    expect(cookieName()).toBe("stone_harbor_tennis_auth");
  });

  it("generates a stable SHA-256 admin token from AUTH_SECRET", () => {
    process.env.AUTH_SECRET = "tennis123";

    expect(adminToken()).toBe("5e5787ed2f3adb941b2937ccd2a9d271311ed8b1cbb833af775f1dcd93a4db46");
  });
});
