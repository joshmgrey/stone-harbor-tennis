import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const findUnique = vi.fn();
const upsert = vi.fn();
const findFirst = vi.fn();
const create = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: (a: unknown) => findUnique(a) },
    player: { upsert: (a: unknown) => upsert(a) },
    signup: {
      findFirst: (a: unknown) => findFirst(a),
      create: (a: unknown) => create(a),
    },
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

// A 2-court session (capacity 8) with `count` regulars already signed up.
const sessionWith = (count: number) => ({
  id: 1,
  courts: 2,
  _count: { signups: count },
});

beforeEach(() => {
  findUnique.mockReset();
  upsert.mockReset().mockResolvedValue({ id: 10 });
  findFirst.mockReset().mockResolvedValue(null);
  create.mockReset().mockImplementation((a) => ({ id: 99, ...a.data }));
});

describe("POST /api/sessions/:id/signups", () => {
  it("creates a signup on the happy path and returns 201", async () => {
    findUnique.mockResolvedValue(sessionWith(3));

    const res = await POST(jsonRequest({ name: "Alice", phone: "555-1212" }), ctx("1"));
    expect(res.status).toBe(201);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "Alice" } })
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { session_id: 1, player_id: 10, is_alternate: false },
      })
    );
  });

  it("trims the name and normalizes a blank phone to null", async () => {
    findUnique.mockResolvedValue(sessionWith(0));

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

  it("returns 404 when the session does not exist", async () => {
    findUnique.mockResolvedValue(null);

    const res = await POST(jsonRequest({ name: "Alice" }), ctx("999"));
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 409 when the player is already signed up to play", async () => {
    findUnique.mockResolvedValue(sessionWith(3));
    findFirst.mockResolvedValue({ id: 5, is_alternate: false });

    const res = await POST(jsonRequest({ name: "Alice" }), ctx("1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "You're already signed up to play this session.",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 409 with the alternate-list message on a duplicate alternate signup", async () => {
    findUnique.mockResolvedValue(sessionWith(3));
    findFirst.mockResolvedValue({ id: 6, is_alternate: true });

    const res = await POST(jsonRequest({ name: "Alice" }), ctx("1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/alternate list/);
  });

  it("returns 409 when the session is full and the player is not joining as an alternate", async () => {
    findUnique.mockResolvedValue(sessionWith(8)); // capacity is 8

    const res = await POST(jsonRequest({ name: "Alice" }), ctx("1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/full/);
    expect(create).not.toHaveBeenCalled();
  });

  it("lets a player join a full session as an alternate", async () => {
    findUnique.mockResolvedValue(sessionWith(8));

    const res = await POST(
      jsonRequest({ name: "Alice", is_alternate: true }),
      ctx("1")
    );
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ is_alternate: true }),
      })
    );
  });
});
