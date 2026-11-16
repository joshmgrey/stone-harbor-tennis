-- register_signup: a public signup (player upsert, duplicate check, capacity
-- check, insert) as one PL/pgSQL function so it runs atomically inside the
-- database.
--
-- Locks the session row (FOR UPDATE) so concurrent signups for the same
-- session serialize. Under that lock it re-checks that the session exists,
-- looks up the player by name, rejects a player who is already on the list,
-- enforces capacity for non-alternates, then creates the player if new and
-- inserts the signup. The lock is held
-- until the calling statement's transaction commits, so the next waiter's
-- count sees this insert.
--
-- Players: the form is unauthenticated (anyone can type any name), so a
-- rejected request changes nothing: a new player is only created, and a
-- missing phone only filled in, once the signup is actually going to be
-- created. An existing phone is never overwritten here; the organizer edits
-- phones (PATCH /api/players/:id). New players are inserted with
-- ON CONFLICT DO NOTHING so two first-time signups under the same new name
-- (for different sessions) can't race into a unique violation.
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
-- Capacity is courts * p_players_per_court, with courts read under the lock
-- so a concurrent change to a session's courts is respected. This mirrors
-- capacity() in src/lib/session.ts (used for display); the caller passes
-- PLAYERS_PER_COURT from there so the constant lives in one place.
--
-- Additive: the running app doesn't call this until the new code deploys.
-- SECURITY INVOKER (the default), so it runs with the app role's existing
-- table grants; functions are executable by PUBLIC by default.
CREATE OR REPLACE FUNCTION register_signup(
  p_session_id   integer,
  p_name         text,
  p_phone        text,
  p_is_alternate      boolean,
  p_players_per_court integer
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
  v_courts             integer;
  v_player             players%ROWTYPE;
  v_player_exists      boolean;
  v_signup             signups%ROWTYPE;
  v_existing_alternate boolean;
  v_taken              integer;
BEGIN
  SELECT s.courts INTO v_courts FROM sessions s WHERE s.id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    status := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_player FROM players p WHERE p.name = p_name;
  v_player_exists := FOUND;

  IF v_player_exists THEN
    SELECT su.is_alternate INTO v_existing_alternate
    FROM signups su
    WHERE su.session_id = p_session_id AND su.player_id = v_player.id
    LIMIT 1;

    IF FOUND THEN
      status := CASE WHEN v_existing_alternate THEN 'already_alternate' ELSE 'already_playing' END;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF NOT p_is_alternate THEN
    SELECT count(*) INTO v_taken
    FROM signups su
    WHERE su.session_id = p_session_id AND NOT su.is_alternate;

    IF v_taken >= v_courts * p_players_per_court THEN
      status := 'full';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- The signup will be created, so only now create a new player (a rejected
  -- request leaves no row behind), or fill in a missing phone for an existing
  -- one (never overwrite it; the organizer edits phones).
  IF NOT v_player_exists THEN
    INSERT INTO players (name, phone)
    VALUES (p_name, p_phone)
    ON CONFLICT (name) DO NOTHING
    RETURNING * INTO v_player;

    IF NOT FOUND THEN
      -- A concurrent signup for another session just created this name (that
      -- request can't be for this session: it would need our lock). This
      -- statement gets a fresh snapshot, so it sees that row.
      SELECT * INTO v_player FROM players p WHERE p.name = p_name;
    END IF;
  ELSIF v_player.phone IS NULL AND p_phone IS NOT NULL THEN
    UPDATE players SET phone = p_phone WHERE id = v_player.id AND phone IS NULL;
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
