import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const isAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({ isAdmin: () => isAdmin() }));

const findMany = vi.fn();
const create = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { session: { findMany: () => findMany(), create: (a: unknown) => create(a) } },
}));

import { GET, POST } from "./route";

const jsonRequest = (body: unknown) =>
  new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  isAdmin.mockReset();
  findMany.mockReset();
  create.mockReset();
});

describe("GET /api/sessions", () => {
  it("replaces the _count relation with signup_count and drops max_players", async () => {
    findMany.mockResolvedValue([
      { id: 1, date: "2026-09-01", max_players: 16, _count: { signups: 3 } },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 1, date: "2026-09-01", signup_count: 3 },
    ]);
  });
});

describe("POST /api/sessions", () => {
  it("rejects a non-admin with 401", async () => {
    isAdmin.mockResolvedValue(false);

    const res = await POST(jsonRequest({ date: "2026-09-01" }));
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("requires date, start_time and end_time", async () => {
    isAdmin.mockResolvedValue(true);

    const res = await POST(jsonRequest({ date: "2026-09-01" }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a session, defaulting courts to 2 and deriving max_players", async () => {
    isAdmin.mockResolvedValue(true);
    create.mockResolvedValue({
      id: 7,
      date: "2026-09-01",
      start_time: "18:00",
      end_time: "20:00",
      courts: 2,
      max_players: 8,
      _count: { signups: 0 },
    });

    const res = await POST(
      jsonRequest({ date: "2026-09-01", start_time: "18:00", end_time: "20:00" })
    );

    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courts: 2, max_players: 8 }),
      })
    );
    const body = await res.json();
    expect(body).toMatchObject({ id: 7, courts: 2, signup_count: 0 });
    expect(body).not.toHaveProperty("max_players");
  });

  it("derives max_players from an explicit court count", async () => {
    isAdmin.mockResolvedValue(true);
    create.mockResolvedValue({ id: 8, _count: { signups: 0 } });

    await POST(
      jsonRequest({
        date: "2026-09-01",
        start_time: "18:00",
        end_time: "20:00",
        courts: 3,
      })
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ courts: 3, max_players: 12 }),
      })
    );
  });
});
