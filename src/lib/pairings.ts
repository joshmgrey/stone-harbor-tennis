export type PairingPlayer = {
  player: {
    name: string;
  };
};

export type CourtPairing = {
  court_number: number;
  team1_player1: string;
  team1_player2: string;
  team2_player1: string;
  team2_player2: string;
};

export function shufflePlayers<T>(players: T[], random = Math.random): T[] {
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function buildCourtPairings(players: PairingPlayer[]): {
  pairings: CourtPairing[];
  sittingOut: string[];
} {
  const courts = Math.floor(players.length / 4);
  const sittingOut = players.slice(courts * 4).map((p) => p.player.name);
  const pairings = Array.from({ length: courts }, (_, i) => ({
    court_number: i + 1,
    team1_player1: players[i * 4].player.name,
    team1_player2: players[i * 4 + 1].player.name,
    team2_player1: players[i * 4 + 2].player.name,
    team2_player2: players[i * 4 + 3].player.name,
  }));

  return { pairings, sittingOut };
}
