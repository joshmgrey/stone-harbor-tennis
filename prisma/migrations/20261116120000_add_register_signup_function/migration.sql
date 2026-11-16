-- register_signup: a public signup (player upsert, duplicate check, capacity
-- check, insert) as one PL/pgSQL function so it runs atomically inside the
-- database.
--
-- Locks the session row (FOR UPDATE) so concurrent signups for the same
-- session serialize. Under that lock it re-checks that the session exists,
-- finds or creates the player by name, rejects a player who is already on the
-- list, enforces capacity for non-alternates, and inserts. The lock is held
-- until the calling statement's transaction commits, so the next waiter's
-- count sees this insert.
--
-- Player upsert: INSERT ... ON CONFLICT, so two first-time signups under the
-- same new name can't race into a unique violation. The form is
-- unauthenticated, so it never overwrites a phone already on file; it only
-- fills one in when the player has none.
--
-- Returns one row. status is one of
--   'created'           the remaining columns describe the new signup
--   'not_found'         session does not exist (e.g. deleted mid-request)
--   'already_playing'   player is already signed up to play
--   'already_alternate' player is already on the alternate list
--   'full'              no room left for a non-alternate
-- Statuses are returned rather than raised so the caller can map them to
-- HTTP responses without parsing driver error codes. Only public player
-- fields are returned (never the phone).
--
-- p_capacity comes from capacity() in src/lib/session.ts, the single source
-- of the capacity rule.
--
-- Additive: the running app doesn't call this until the new code deploys.
-- SECURITY INVOKER (the default), so it runs with the app role's existing
-- table grants; functions are executable by PUBLIC by default.
CREATE OR REPLACE FUNCTION register_signup(
  p_session_id   integer,
  p_name         text,
  p_phone        text,
  p_is_alternate boolean,
  p_capacity     integer
)
RETURNS TABLE (
  status            text,
  signup_id         integer,
  is_alternate      boolean,
  signed_up_at      timestamp(3),
  player_id         integer,
  player_name       text,
  player_created_at timestamp(3)
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_player             players%ROWTYPE;
  v_signup             signups%ROWTYPE;
  v_existing_alternate boolean;
  v_taken              integer;
BEGIN
  PERFORM 1 FROM sessions s WHERE s.id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    status := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO players AS p (name, phone)
  VALUES (p_name, p_phone)
  ON CONFLICT (name) DO UPDATE SET phone = COALESCE(p.phone, EXCLUDED.phone)
  RETURNING * INTO v_player;

  SELECT su.is_alternate INTO v_existing_alternate
  FROM signups su
  WHERE su.session_id = p_session_id AND su.player_id = v_player.id
  LIMIT 1;

  IF FOUND THEN
    status := CASE WHEN v_existing_alternate THEN 'already_alternate' ELSE 'already_playing' END;
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT p_is_alternate THEN
    SELECT count(*) INTO v_taken
    FROM signups su
    WHERE su.session_id = p_session_id AND NOT su.is_alternate;

    IF v_taken >= p_capacity THEN
      status := 'full';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  INSERT INTO signups (session_id, player_id, is_alternate)
  VALUES (p_session_id, v_player.id, p_is_alternate)
  RETURNING * INTO v_signup;

  status            := 'created';
  signup_id         := v_signup.id;
  is_alternate      := v_signup.is_alternate;
  signed_up_at      := v_signup.signed_up_at;
  player_id         := v_player.id;
  player_name       := v_player.name;
  player_created_at := v_player.created_at;
  RETURN NEXT;
END;
$$;
