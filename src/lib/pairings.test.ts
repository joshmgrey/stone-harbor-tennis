import { describe, expect, it } from "vitest";
import { buildCourtPairings, shufflePlayers } from "./pairings";

const player = (name: string) => ({ player: { name } });

describe("pairing helpers", () => {
  it("builds one court per four players and tracks players sitting out", () => {
    const result = buildCourtPairings([
      player("Ann"),
      player("Ben"),
      player("Cam"),
      player("Dee"),
      player("Eli"),
    ]);

    expect(result.pairings).toEqual([
      {
        court_number: 1,
        team1_player1: "Ann",
        team1_player2: "Ben",
        team2_player1: "Cam",
        team2_player2: "Dee",
      },
    ]);
    expect(result.sittingOut).toEqual(["Eli"]);
  });

  it("does not mutate the original player list when shuffling", () => {
    const players = ["Ann", "Ben", "Cam", "Dee"];
    const shuffled = shufflePlayers(players, () => 0);

    expect(players).toEqual(["Ann", "Ben", "Cam", "Dee"]);
    expect(shuffled).toHaveLength(players.length);
    expect([...shuffled].sort()).toEqual([...players].sort());
  });
});
