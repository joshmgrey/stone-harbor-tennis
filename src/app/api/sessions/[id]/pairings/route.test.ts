import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const isAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({ isAdmin: () => isAdmin() }));

const findMany = vi.fn();
const pairingFindMany = vi.fn();
const deleteMany = vi.fn();
const create = vi.fn();
const $transaction = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    signup: { findMany: (a: unknown) => findMany(a) },
    pairing: {
      findMany: (a: unknown) => pairingFindMany(a),
      deleteMany: (a: unknown) => deleteMany(a),
      create: (a: unknown) => create(a),
    },
    $transaction: (ops: unknown) => $transaction(ops),
  },
}));

import { GET, POST } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = {} as NextRequest;

const signups = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ player: { name: `P${i + 1}` } }));

beforeEach(() => {
  isAdmin.mockReset();
  findMany.mockReset();
  pairingFindMany.mockReset().mockResolvedValue([]);
  deleteMany.mockReset().mockReturnValue({ op: "deleteMany" });
  create.mockReset().mockImplementation((a) => a);
  // The route builds [deleteMany, ...creates]; echo back the create payloads.
  $transaction.mockReset().mockImplementation((ops: unknown[]) => ops);
});

describe("GET /api/sessions/:id/pairings", () => {
  it("returns the session's pairings ordered by court number", async () => {
    const rows = [
      { id: 1, session_id: 9, court_number: 1 },
      { id: 2, session_id: 9, court_number: 2 },
    ];
    pairingFindMany.mockResolvedValue(rows);

    const res = await GET(req, ctx("9"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
    expect(pairingFindMany).toHaveBeenCalledWith({
      where: { session_id: 9 },
      orderBy: { court_number: "asc" },
    });
  });

  it("returns an empty list when no pairings exist yet", async () => {
    pairingFindMany.mockResolvedValue([]);

    const res = await GET(req, ctx("1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("POST /api/sessions/:id/pairings", () => {
  it("rejects a non-admin with 401", async () => {
    isAdmin.mockResolvedValue(false);

    const res = await POST(req, ctx("1"));
    expect(res.status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("needs at least four non-alternate players", async () => {
    isAdmin.mockResolvedValue(true);
    findMany.mockResolvedValue(signups(3));

    const res = await POST(req, ctx("1"));
    expect(res.status).toBe(400);
    expect($transaction).not.toHaveBeenCalled();
  });

  it("only pairs non-alternates", async () => {
    isAdmin.mockResolvedValue(true);
    findMany.mockResolvedValue(signups(8));

    await POST(req, ctx("42"));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { session_id: 42, is_alternate: false },
      })
    );
  });

  it("replaces existing pairings atomically: one deleteMany + one create per court", async () => {
    isAdmin.mockResolvedValue(true);
    findMany.mockResolvedValue(signups(11)); // 2 courts, 3 sitting out

    const res = await POST(req, ctx("7"));
    expect(res.status).toBe(200);

    const ops = $transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(3); // deleteMany + 2 courts
    expect(deleteMany).toHaveBeenCalledWith({ where: { session_id: 7 } });
    expect(create).toHaveBeenCalledTimes(2);

    const body = await res.json();
    expect(body.sittingOut).toHaveLength(3);
    expect(body.pairings).toHaveLength(2);
  });

  it("assigns four distinct players to each created court", async () => {
    isAdmin.mockResolvedValue(true);
    findMany.mockResolvedValue(signups(8));

    await POST(req, ctx("1"));

    for (const call of create.mock.calls) {
      const { team1_player1, team1_player2, team2_player1, team2_player2 } =
        call[0].data;
      const four = [team1_player1, team1_player2, team2_player1, team2_player2];
      expect(new Set(four).size).toBe(4);
    }
  });
});
