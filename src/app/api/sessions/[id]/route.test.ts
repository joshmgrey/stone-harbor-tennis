import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const isAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({ isAdmin: () => isAdmin() }));

const findUnique = vi.fn();
const findMany = vi.fn();
const deleteFn = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: {
      findUnique: (a: unknown) => findUnique(a),
      delete: (a: unknown) => deleteFn(a),
    },
    signup: { findMany: (a: unknown) => findMany(a) },
  },
}));

import { GET, DELETE } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = {} as NextRequest;

beforeEach(() => {
  isAdmin.mockReset();
  findUnique.mockReset();
  findMany.mockReset().mockResolvedValue([]);
  deleteFn.mockReset().mockResolvedValue({ id: 1 });
});

describe("GET /api/sessions/:id", () => {
  it("returns the session with signup_count and without max_players, plus its signups", async () => {
    findUnique.mockResolvedValue({
      id: 1,
      date: "2026-09-01",
      max_players: 8,
      _count: { signups: 3 },
    });
    findMany.mockResolvedValue([{ id: 5, player: { name: "Alice" } }]);

    const res = await GET(req, ctx("1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.session).toEqual({ id: 1, date: "2026-09-01", signup_count: 3 });
    expect(body.session).not.toHaveProperty("max_players");
    expect(body.signups).toEqual([{ id: 5, player: { name: "Alice" } }]);
  });

  it("orders regulars before alternates, each by sign-up time", async () => {
    findUnique.mockResolvedValue({ id: 1, _count: { signups: 0 } });

    await GET(req, ctx("1"));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { session_id: 1 },
        orderBy: [{ is_alternate: "asc" }, { signed_up_at: "asc" }],
      })
    );
  });

  it("returns 404 when the session does not exist", async () => {
    findUnique.mockResolvedValue(null);

    const res = await GET(req, ctx("999"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Session not found" });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/sessions/:id", () => {
  it("rejects a non-admin with 401 and does not delete", async () => {
    isAdmin.mockResolvedValue(false);

    const res = await DELETE(req, ctx("1"));
    expect(res.status).toBe(401);
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("deletes the session by numeric id for an admin", async () => {
    isAdmin.mockResolvedValue(true);

    const res = await DELETE(req, ctx("1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});
