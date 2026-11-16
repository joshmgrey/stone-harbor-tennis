import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const isAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({ isAdmin: () => isAdmin() }));

const updateMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { player: { updateMany: (a: unknown) => updateMany(a) } },
}));

import { PATCH } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const patch = (body: string) =>
  new Request("http://localhost/api/players/7", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body,
  }) as unknown as NextRequest;

const json = (body: unknown) => patch(JSON.stringify(body));

beforeEach(() => {
  isAdmin.mockReset().mockResolvedValue(true);
  updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe("PATCH /api/players/:id", () => {
  it("rejects a non-admin with 401 and does not update", async () => {
    isAdmin.mockResolvedValue(false);

    const res = await PATCH(json({ phone: "555-1212" }), ctx("7"));
    expect(res.status).toBe(401);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("sets a trimmed phone", async () => {
    const res = await PATCH(json({ phone: "  555-1212 " }), ctx("7"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, phone: "555-1212" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { phone: "555-1212" },
    });
  });

  it.each([null, "", "   "])("clears the phone for %j", async (phone) => {
    const res = await PATCH(json({ phone }), ctx("7"));
    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 7 }, data: { phone: null } });
  });

  it.each([{}, { phone: 5551212 }, { phone: ["555"] }])(
    "rejects a missing or non-text phone (%j) with 400",
    async (body) => {
      const res = await PATCH(json(body), ctx("7"));
      expect(res.status).toBe(400);
      expect(updateMany).not.toHaveBeenCalled();
    }
  );

  it("rejects an overlong phone with 400", async () => {
    const res = await PATCH(json({ phone: "5".repeat(33) }), ctx("7"));
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(["not json", "null"])("rejects body %j with 400", async (body) => {
    const res = await PATCH(patch(body), ctx("7"));
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 for an invalid id without querying", async () => {
    const res = await PATCH(json({ phone: "555" }), ctx("abc"));
    expect(res.status).toBe(404);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the player does not exist", async () => {
    updateMany.mockResolvedValue({ count: 0 });

    const res = await PATCH(json({ phone: "555" }), ctx("999"));
    expect(res.status).toBe(404);
  });
});
