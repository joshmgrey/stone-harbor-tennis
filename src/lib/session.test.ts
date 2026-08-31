import { describe, expect, it } from "vitest";
import { capacity, PLAYERS_PER_COURT } from "./session";

describe("capacity", () => {
  it("seats four players per court", () => {
    expect(PLAYERS_PER_COURT).toBe(4);
  });

  it.each([
    [1, 4],
    [2, 8],
    [3, 12],
    [5, 20],
  ])("courts=%i -> capacity %i", (courts, expected) => {
    expect(capacity({ courts })).toBe(expected);
  });

  it("is zero when there are no courts", () => {
    expect(capacity({ courts: 0 })).toBe(0);
  });
});
