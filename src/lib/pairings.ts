import { PLAYERS_PER_COURT } from "./session";

export interface CourtPairing {
  court_number: number;
  team1_player1: string;
  team1_player2: string;
  team2_player1: string;
  team2_player2: string;
}

export interface PairingResult {
  pairings: CourtPairing[];
  /** Players with no court this round (fewer than four were left over). */
  sittingOut: string[];
}

/**
 * Fisher-Yates shuffle, returning a new array. `rng` returns a float in
 * [0, 1) — pass a seeded generator for deterministic output in tests.
 */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Split players across courts, four to a court (two per team). The order is
 * randomised first so pairings vary between runs; pass a seeded `rng` for a
 * deterministic result. Any leftover players (fewer than four) sit out.
 */
export function buildPairings(
  names: string[],
  rng: () => number = Math.random
): PairingResult {
  const players = shuffle(names, rng);
  const courts = Math.floor(players.length / PLAYERS_PER_COURT);

  const pairings: CourtPairing[] = Array.from({ length: courts }, (_, i) => {
    const base = i * PLAYERS_PER_COURT;
    return {
      court_number: i + 1,
      team1_player1: players[base],
      team1_player2: players[base + 1],
      team2_player1: players[base + 2],
      team2_player2: players[base + 3],
    };
  });

  return {
    pairings,
    sittingOut: players.slice(courts * PLAYERS_PER_COURT),
  };
}
