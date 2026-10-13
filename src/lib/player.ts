/**
 * The player fields any visitor may see. Phone numbers are for the organizer
 * only, so every unauthenticated response that includes a player selects
 * through this instead of returning the whole row.
 */
export const publicPlayerSelect = {
  id: true,
  name: true,
  created_at: true,
} as const;
