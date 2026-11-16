/** Doubles: four players per court. */
export const PLAYERS_PER_COURT = 4;

/**
 * How many players a session seats. Alternates sit outside this.
 * The register_signup PL/pgSQL function enforces the same rule (courts *
 * PLAYERS_PER_COURT, passed in) under its row lock — change both together.
 */
export function capacity(session: { courts: number }): number {
  return session.courts * PLAYERS_PER_COURT;
}
