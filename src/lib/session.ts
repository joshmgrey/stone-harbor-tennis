/** Doubles: four players per court. */
export const PLAYERS_PER_COURT = 4;

/** How many players a session seats. Alternates sit outside this. */
export function capacity(session: { courts: number }): number {
  return session.courts * PLAYERS_PER_COURT;
}
