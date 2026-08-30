export interface Session {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  courts: number;
  notes: string | null;
  created_at: string;
  /** Regular (non-alternate) sign-ups. */
  signup_count?: number;
}

export interface Signup {
  id: number;
  session_id: number;
  player_id: number;
  player: Player;
  is_alternate: boolean;
  signed_up_at: string;
}

export interface Player {
  id: number;
  name: string;
  phone: string | null;
  created_at: string;
}

export interface Pairing {
  id: number;
  session_id: number;
  court_number: number;
  team1_player1: string;
  team1_player2: string;
  team2_player1: string;
  team2_player2: string;
  generated_at: string;
}
