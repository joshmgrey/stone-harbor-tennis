-- register_signup: the signup capacity check and insert, as one PL/pgSQL
-- function so they run atomically inside the database.
--
-- Locks the session row (FOR UPDATE) so concurrent signups for the same
-- session serialize. Under that lock it re-checks that the session exists,
-- rejects a player who is already on the list, enforces capacity for
-- non-alternates, and inserts. The lock is held until the calling statement's
-- transaction commits, so the next waiter's count sees this insert.
--
-- Returns one row: (status, signup_id). status is one of
--   'created'           signup_id is the new row
--   'not_found'         session does not exist (e.g. deleted mid-request)
--   'already_playing'   player is already signed up to play
--   'already_alternate' player is already on the alternate list
--   'full'              no room left for a non-alternate
-- Statuses are returned rather than raised so the caller can map them to
-- HTTP responses without parsing driver error codes.
--
-- Capacity is courts * p_players_per_court; the caller passes
-- PLAYERS_PER_COURT (src/lib/session.ts) so that constant stays in one place.
--
-- Additive: the running app doesn't call this until the new code deploys.
-- SECURITY INVOKER (the default), so it runs with the app role's existing
-- table grants; functions are executable by PUBLIC by default.
CREATE OR REPLACE FUNCTION register_signup(
  p_session_id        integer,
  p_player_id         integer,
  p_is_alternate      boolean,
  p_players_per_court integer
)
RETURNS TABLE (status text, signup_id integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_courts             integer;
  v_existing_alternate boolean;
  v_taken              integer;
  v_signup_id          integer;
BEGIN
  SELECT s.courts INTO v_courts
  FROM sessions s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::integer;
    RETURN;
  END IF;

  SELECT su.is_alternate INTO v_existing_alternate
  FROM signups su
  WHERE su.session_id = p_session_id AND su.player_id = p_player_id
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT
      CASE WHEN v_existing_alternate THEN 'already_alternate' ELSE 'already_playing' END::text,
      NULL::integer;
    RETURN;
  END IF;

  IF NOT p_is_alternate THEN
    SELECT count(*) INTO v_taken
    FROM signups su
    WHERE su.session_id = p_session_id AND NOT su.is_alternate;

    IF v_taken >= v_courts * p_players_per_court THEN
      RETURN QUERY SELECT 'full'::text, NULL::integer;
      RETURN;
    END IF;
  END IF;

  INSERT INTO signups (session_id, player_id, is_alternate)
  VALUES (p_session_id, p_player_id, p_is_alternate)
  RETURNING id INTO v_signup_id;

  RETURN QUERY SELECT 'created'::text, v_signup_id;
END;
$$;
