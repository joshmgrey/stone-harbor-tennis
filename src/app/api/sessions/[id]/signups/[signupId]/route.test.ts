import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const isAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({ isAdmin: () => isAdmin() }));

const deleteMany = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    signup: {
      deleteMany: (a: unknown) => deleteMany(a),
      update: (a: unknown) => update(a),
    },
  },
}));

import { DELETE, PATCH } from "./route";

const ctx = (id: string, signupId: string) => ({
  params: Promise.resolve({ id, signupId }),
});

const rawPatch = (body: string) =>
  new Request("http://localhost/api/sessions/1/signups/2", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body,
  }) as unknown as NextRequest;

const patchRequest = (body: unknown) => rawPatch(JSON.stringify(body));

const req = {} as NextRequest;

beforeEach(() => {
  isAdmin.mockReset().mockResolvedValue(true);
  deleteMany.mockReset().mockResolvedValue({ count: 1 });
  update
    .mockReset()
    .mockResolvedValue({ id: 2, session_id: 1, is_alternate: true, player: { id: 9 } });
});

describe("DELETE /api/sessions/:id/signups/:signupId", () => {
  it("rejects a non-admin with 401 and does not delete", async () => {
    isAdmin.mockResolvedValue(false);

    const res = await DELETE(req, ctx("1", "2"));
    expect(res.status).toBe(401);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("deletes the signup scoped to its session for an admin", async () => {
    const res = await DELETE(req, ctx("1", "2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 2, session_id: 1 } });
  });

  it("returns 404 when the signup is already gone or in another session", async () => {
    deleteMany.mockResolvedValue({ count: 0 });

    const res = await DELETE(req, ctx("999", "2"));
    expect(res.status).toBe(404);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 2, session_id: 999 } });
  });
});

describe("PATCH /api/sessions/:id/signups/:signupId", () => {
  it("rejects a non-admin with 401 and does not update", async () => {
    isAdmin.mockResolvedValue(false);

    const res = await PATCH(patchRequest({ is_alternate: true }), ctx("1", "2"));
    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 400 when is_alternate is not a boolean", async () => {
    const res = await PATCH(patchRequest({ is_alternate: "yes" }), ctx("1", "2"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "is_alternate must be a boolean",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it.each(["", "not json", "null"])("returns 400 for body %j", async (body) => {
    const res = await PATCH(rawPatch(body), ctx("1", "2"));
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("moves a signup scoped to its session in one update and returns it", async () => {
    const res = await PATCH(patchRequest({ is_alternate: true }), ctx("1", "2"));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 2, session_id: 1 },
      data: { is_alternate: true },
      include: { player: true },
    });
    expect(await res.json()).toMatchObject({ id: 2, is_alternate: true });
  });

  it("returns 404 when the signup is gone or in another session (P2025)", async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("No record found", {
        code: "P2025",
        clientVersion: "test",
      })
    );

    const res = await PATCH(patchRequest({ is_alternate: true }), ctx("999", "2"));
    expect(res.status).toBe(404);
  });

  it("rethrows other database errors", async () => {
    update.mockRejectedValue(new Error("connection lost"));

    await expect(
      PATCH(patchRequest({ is_alternate: true }), ctx("1", "2"))
    ).rejects.toThrow("connection lost");
  });
});

describe("malformed ids", () => {
  it.each([
    ["1", "abc"],
    ["abc", "2"],
  ])("DELETE (session %j, signup %j) returns 404 without deleting", async (id, signupId) => {
    const res = await DELETE(req, ctx(id, signupId));
    expect(res.status).toBe(404);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("PATCH returns 404 without updating", async () => {
    const res = await PATCH(patchRequest({ is_alternate: true }), ctx("1", "1e3"));
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});
