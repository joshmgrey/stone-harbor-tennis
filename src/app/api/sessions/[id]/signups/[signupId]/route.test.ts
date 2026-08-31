import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const isAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({ isAdmin: () => isAdmin() }));

const deleteFn = vi.fn();
const update = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    signup: {
      delete: (a: unknown) => deleteFn(a),
      update: (a: unknown) => update(a),
    },
  },
}));

import { DELETE, PATCH } from "./route";

const ctx = (id: string, signupId: string) => ({
  params: Promise.resolve({ id, signupId }),
});

const patchRequest = (body: unknown) =>
  new Request("http://localhost/api/sessions/1/signups/2", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const req = {} as NextRequest;

beforeEach(() => {
  isAdmin.mockReset();
  deleteFn.mockReset().mockResolvedValue({ id: 2 });
  update.mockReset().mockImplementation((a) => ({ id: 2, ...a.data }));
});

describe("DELETE /api/sessions/:id/signups/:signupId", () => {
  it("rejects a non-admin with 401 and does not delete", async () => {
    isAdmin.mockResolvedValue(false);

    const res = await DELETE(req, ctx("1", "2"));
    expect(res.status).toBe(401);
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("deletes the signup by numeric id for an admin", async () => {
    isAdmin.mockResolvedValue(true);

    const res = await DELETE(req, ctx("1", "2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 2 } });
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
    isAdmin.mockResolvedValue(true);

    const res = await PATCH(patchRequest({ is_alternate: "yes" }), ctx("1", "2"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "is_alternate must be a boolean",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("moves a signup between regular and alternate for an admin", async () => {
    isAdmin.mockResolvedValue(true);

    const res = await PATCH(patchRequest({ is_alternate: true }), ctx("1", "2"));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 2 },
        data: { is_alternate: true },
      })
    );
  });
});
