import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const findUnique = vi.fn();
const upsert = vi.fn();
const queryRaw = vi.fn();
const signupFindUnique = vi.fn();

// The duplicate check, capacity check and insert run inside the
// `register_signup` PL/pgSQL function, called via `prisma.$queryRaw`. These
// tests mock its result row; the locking itself is exercised against a real
// Postgres by scripts/load-test-signup.js and the CI e2e job.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: (a: unknown) => findUnique(a) },
    player: { upsert: (a: unknown) => upsert(a) },
    signup: { findUnique: (a: unknown) => signupFindUnique(a) },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));

import { POST } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const jsonRequest = (body: unknown) =>
  new Request("http://localhost/api/sessions/1/signups", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const session = { id: 1, courts: 2 };

/** Make register_signup report `status` (and a signup id when created). */
const registerReturns = (status: string, signup_id: number | null = null) =>
  queryRaw.mockResolvedValue([{ status, signup_id }]);

/** The interpolated values passed to the register_signup tagged template. */
const registerArgs = () => queryRaw.mock.calls[0].slice(1);

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(session);
  upsert.mockReset().mockResolvedValue({ id: 10 });
  queryRaw.mockReset();
  registerReturns("created", 99);
  signupFindUnique
    .mockReset()
    .mockImplementation((a) => ({ id: a.where.id, session_id: 1, player_id: 10 }));
});

describe("POST /api/sessions/:id/signups", () => {
  it("creates a signup on the happy path and returns 201", async () => {
    const res = await POST(jsonRequest({ name: "Alice", phone: "555-1212" }), ctx("1"));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 99 });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "Alice" } })
    );
    // session id, player id, alternate flag, players per court
    expect(registerArgs()).toEqual([1, 10, false, 4]);
  });

  it("calls the register_signup function", async () => {
    await POST(jsonRequest({ name: "Alice" }), ctx("1"));

    const sql = (queryRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toMatch(/FROM register_signup\(/);
  });

  it("passes the alternate flag through", async () => {
    await POST(jsonRequest({ name: "Alice", is_alternate: true }), ctx("1"));
    expect(registerArgs()[2]).toBe(true);
  });

  it("treats a non-boolean is_alternate as false", async () => {
    await POST(jsonRequest({ name: "Alice", is_alternate: "yes" }), ctx("1"));
    expect(registerArgs()[2]).toBe(false);
  });

  it("does not return the player's phone number", async () => {
    await POST(jsonRequest({ name: "Alice" }), ctx("1"));

    expect(signupFindUnique).toHaveBeenCalledWith({
      where: { id: 99 },
      include: {
        player: { select: { id: true, name: true, created_at: true } },
      },
    });
  });

  it("trims the name and normalizes a blank phone to null", async () => {
    await POST(jsonRequest({ name: "  Bob  ", phone: "   " }), ctx("1"));

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: "Bob" },
        create: { name: "Bob", phone: null },
      })
    );
  });

  it("rejects a missing/blank name with 400 before hitting the database", async () => {
    const res = await POST(jsonRequest({ name: "   " }), ctx("1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Name is required" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 without creating a player when the session does not exist", async () => {
    findUnique.mockResolvedValue(null);

    const res = await POST(jsonRequest({ name: "Alice" }), ctx("999"));
    expect(res.status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("returns 404 when the session is deleted before the signup locks it", async () => {
    registerReturns("not_found");

    const res = await POST(jsonRequest({ name: "Alice" }), ctx("1"));
    expect(res.status).toBe(404);
    expect(signupFindUnique).not.toHaveBeenCalled();
  });

  it("returns 409 when the player is already signed up to play", async () => {
    registerReturns("already_playing");

    const res = await POST(jsonRequest({ name: "Alice" }), ctx("1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "You're already signed up to play this session.",
    });
    expect(signupFindUnique).not.toHaveBeenCalled();
  });

  it("returns 409 with the alternate-list message on a duplicate alternate signup", async () => {
    registerReturns("already_alternate");

    const res = await POST(jsonRequest({ name: "Alice" }), ctx("1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/alternate list/);
  });

  it("returns 409 when the session is full", async () => {
    registerReturns("full");

    const res = await POST(jsonRequest({ name: "Alice" }), ctx("1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/full/);
    expect(signupFindUnique).not.toHaveBeenCalled();
  });
});
