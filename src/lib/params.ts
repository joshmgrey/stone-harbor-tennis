/** Largest value a Postgres `integer` column (our ids) can hold. */
const PG_INT_MAX = 2_147_483_647;

/**
 * Parse a route `[id]` segment as a database id. Only canonical positive
 * decimal integers that fit a Postgres `integer` are accepted, so forms like
 * "1e3", " 1 ", "0x10" or "1.0" don't resolve to a real row. Returns null
 * otherwise; callers treat that as not found.
 */
export function parseId(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= PG_INT_MAX ? n : null;
}
