import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const queryRaw = vi.fn();

// The player upsert, duplicate check, capacity check and insert run inside
// the `register_signup` PL/pgSQL function, called via `prisma.$queryRaw`.
// These tests mock its result row; the function itself (locking included) is
// tested against a real Postgres in src/db/register-signup.integration.test.ts.
vi.mock("@/lib/prisma", () => ({
  prisma: {
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

const signedUpAt = new Date("2026-11-16T19:00:00.000Z");
const playerCreatedAt = new Date("2026-11-01T12:00:00.000Z");

const createdRow = {
  status: "created",
  signup_id: 99,
  is_alternate: false,
  signed_up_at: signedUpAt,
  player_id: 10,
  player_name: "Alice",
  player_created_at: playerCreatedAt,
};

/** Make register_signup report a non-created status. */
const registerReturns = (status: string) =>
  queryRaw.mockResolvedValue([
    {
      status,
      signup_id: null,
      is_alternate: null,
      signed_up_at: null,
      player_id: null,
      player_name: null,
      player_created_at: null,
    },
  ]);

/** The interpolated values passed to the register_signup tagged template. */
const registerArgs = () => queryRaw.mock.calls[0].slice(1);

beforeEach(() => {
  queryRaw.mockReset().mockResolvedValue([createdRow]);
});

describe("POST /api/sessions/:id/signups", () => {
  it("creates a signup on the happy path and returns 201 with public fields", async () => {
    const res = await POST(jsonRequest({ name: "Alice", phone: "555-1212" }), ctx("1"));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 99,
      session_id: 1,
      player_id: 10,
      is_alternate: false,
      signed_up_at: signedUpAt.toISOString(),
      player: { id: 10, name: "Alice", created_at: playerCreatedAt.toISOString() },
    });

    // session id, name, phone, alternate flag, players per court
    expect(registerArgs()).toEqual([1, "Alice", "555-1212", false, 4]);
  });

  it("calls the register_signup function", async () => {
    await POST(jsonRequest({ name: "Alice" }), ctx("1"));

    const sql = (queryRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toMatch(/FROM register_signup\(/);
  });

  it("passes the alternate flag through", async () => {
    await POST(jsonRequest({ name: "Alice", is_alternate: true }), ctx("1"));
    expect(registerArgs()[3]).toBe(true);
  });

  it("treats a non-boolean is_alternate as false", async () => {
    await POST(jsonRequest({ name: "Alice", is_alternate: "yes" }), ctx("1"));
    expect(registerArgs()[3]).toBe(false);
  });

  it("does not return a phone number", async () => {
    const res = await POST(jsonRequest({ name: "Alice", phone: "555-1212" }), ctx("1"));
    expect(JSON.stringify(await res.json())).not.toMatch(/phone|555-1212/);
  });

  it("trims the name and normalizes a blank phone to null", async () => {
    await POST(jsonRequest({ name: "  Bob  ", phone: "   " }), ctx("1"));
    expect(registerArgs().slice(1, 3)).toEqual(["Bob", null]);
  });

  it("rejects a missing/blank name with 400 before hitting the database", async () => {
    const res = await POST(jsonRequest({ name: "   " }), ctx("1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Name is required" });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it.each([123, null, { first: "Alice" }])(
    "rejects a non-string name (%j) with 400",
    async (name) => {
      const res = await POST(jsonRequest({ name }), ctx("1"));
      expect(res.status).toBe(400);
      expect(queryRaw).not.toHaveBeenCalled();
    }
  );

  it("rejects a non-string phone with 400", async () => {
    const res = await POST(jsonRequest({ name: "Alice", phone: 5551212 }), ctx("1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Phone must be text" });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it.each(["not json", "null", "[]"])("rejects body %j with 400", async (raw) => {
    const req = new Request("http://localhost/api/sessions/1/signups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    }) as unknown as NextRequest;

    const res = await POST(req, ctx("1"));
    expect(res.status).toBe(400);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it.each(["abc", "1.5", "0", "-3", "2147483648", "1e3", "0x10", " 1"])(
    "returns 404 for an invalid session id (%s) without querying",
    async (id) => {
      const res = await POST(jsonRequest({ name: "Alice" }), ctx(id));
      expect(res.status).toBe(404);
      expect(queryRaw).not.toHaveBeenCalled();
    }
  );

  it("returns 404 when the session does not exist", async () => {
    registerReturns("not_found");

    const res = await POST(jsonRequest({ name: "Alice" }), ctx("1"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when the player is already signed up to play", async () => {
    registerReturns("already_playing");

    const res = await POST(jsonRequest({ name: "Alice" }), ctx("1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "You're already signed up to play this session.",
    });
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
  });

  it("fails loudly if register_signup returns no row", async () => {
    queryRaw.mockResolvedValue([]);

    await expect(POST(jsonRequest({ name: "Alice" }), ctx("1"))).rejects.toThrow(
      /returned no row/
    );
  });
});

describe("length limits", () => {
  it("rejects a name longer than MAX_NAME_LENGTH with 400", async () => {
    const res = await POST(jsonRequest({ name: "a".repeat(81) }), ctx("1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Name is too long" });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("rejects a phone longer than MAX_PHONE_LENGTH with 400", async () => {
    const res = await POST(jsonRequest({ name: "Alice", phone: "5".repeat(33) }), ctx("1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Phone is too long" });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("accepts values exactly at the limits (after trimming)", async () => {
    const res = await POST(
      jsonRequest({ name: ` ${"a".repeat(80)} `, phone: "5".repeat(32) }),
      ctx("1")
    );
    expect(res.status).toBe(201);
  });
});
