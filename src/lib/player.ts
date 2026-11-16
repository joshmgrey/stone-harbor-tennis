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

/**
 * Input limits for player fields, shared by the API routes (which enforce
 * them) and the forms (which set matching `maxLength`s). Generous for real
 * names and numbers with extensions, small enough that the unauthenticated
 * signup form can't be used to store large blobs.
 */
export const MAX_NAME_LENGTH = 80;
export const MAX_PHONE_LENGTH = 32;
