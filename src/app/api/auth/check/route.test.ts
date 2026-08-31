import { beforeEach, describe, expect, it, vi } from "vitest";

const isAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({ isAdmin: () => isAdmin() }));

import { GET } from "./route";

beforeEach(() => {
  isAdmin.mockReset();
});

describe("GET /api/auth/check", () => {
  it("reports admin: true when the caller is an admin", async () => {
    isAdmin.mockResolvedValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: true });
  });

  it("reports admin: false otherwise", async () => {
    isAdmin.mockResolvedValue(false);
    const res = await GET();
    expect(await res.json()).toEqual({ admin: false });
  });
});
