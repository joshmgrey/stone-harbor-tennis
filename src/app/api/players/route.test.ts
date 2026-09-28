import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { player: { findMany: (a: unknown) => findMany(a) } },
}));

import { GET } from "./route";

beforeEach(() => {
  findMany.mockReset();
});

describe("GET /api/players", () => {
  it("returns players ordered by name", async () => {
    const players = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    findMany.mockResolvedValue(players);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(players);
    expect(findMany).toHaveBeenCalledWith({ orderBy: { name: "asc" } });
  });
});
