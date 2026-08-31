import { describe, expect, it } from "vitest";
import { buildPairings, shuffle } from "./pairings";

/** Deterministic PRNG so shuffle-dependent assertions are stable. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const names = (n: number) =>
  Array.from({ length: n }, (_, i) => `P${i + 1}`);

describe("shuffle", () => {
  it("keeps the same multiset of elements", () => {
    const input = names(10);
    const out = shuffle(input, mulberry32(1));
    expect([...out].sort()).toEqual([...input].sort());
  });

  it("does not mutate the input", () => {
    const input = names(6);
    const copy = [...input];
    shuffle(input, mulberry32(2));
    expect(input).toEqual(copy);
  });

  it("is deterministic for a given seed", () => {
    expect(shuffle(names(8), mulberry32(42))).toEqual(
      shuffle(names(8), mulberry32(42))
    );
  });
});

describe("buildPairings", () => {
  it("puts four players on each court and sits the rest out", () => {
    const { pairings, sittingOut } = buildPairings(names(7), mulberry32(3));
    expect(pairings).toHaveLength(1);
    expect(sittingOut).toHaveLength(3);
    expect(pairings[0].court_number).toBe(1);
  });

  it("fills multiple courts and numbers them from 1", () => {
    const { pairings, sittingOut } = buildPairings(names(8), mulberry32(4));
    expect(pairings.map((p) => p.court_number)).toEqual([1, 2]);
    expect(sittingOut).toEqual([]);
  });

  it("assigns every non-sitting player exactly once", () => {
    const { pairings, sittingOut } = buildPairings(names(11), mulberry32(5));
    const seated = pairings.flatMap((p) => [
      p.team1_player1,
      p.team1_player2,
      p.team2_player1,
      p.team2_player2,
    ]);
    expect(seated).toHaveLength(8);
    expect(new Set(seated).size).toBe(8);
    expect([...seated, ...sittingOut].sort()).toEqual(names(11).sort());
  });

  it("returns no courts when fewer than four players", () => {
    const { pairings, sittingOut } = buildPairings(names(3), mulberry32(6));
    expect(pairings).toEqual([]);
    expect(sittingOut.sort()).toEqual(names(3).sort());
  });

  it("handles an exact single court", () => {
    const { pairings, sittingOut } = buildPairings(names(4), mulberry32(7));
    expect(pairings).toHaveLength(1);
    expect(sittingOut).toEqual([]);
  });
});
