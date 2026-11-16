import { NextRequest, NextResponse } from "next/server";
import type { Signup } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PLAYERS_PER_COURT } from "@/lib/session";
import { MAX_NAME_LENGTH, MAX_PHONE_LENGTH, publicPlayerSelect } from "@/lib/player";
import { parseId } from "@/lib/params";

/** Outcome reported by the `register_signup` PL/pgSQL function. */
type RegisterStatus =
  | "created"
  | "not_found"
  | "already_playing"
  | "already_alternate"
  | "full";

/** One row from register_signup; everything but status is null unless created. */
type RegisterResult = {
  status: RegisterStatus;
  signup_id: number | null;
  is_alternate: boolean | null;
  signed_up_at: Date | null;
  player_id: number | null;
  player_name: string | null;
  player_created_at: Date | null;
};

const CONFLICT_MESSAGES: Partial<Record<RegisterStatus, string>> = {
  // This form is unauthenticated, so a name that's already on the list can't
  // change its own spot — that would let anyone move a player between playing
  // and alternate. The organizer moves people (admin PATCH).
  already_playing: "You're already signed up to play this session.",
  already_alternate:
    "You're already on the alternate list. Ask the organizer if a spot opens up.",
  full: "Session is full — you can still join as an alternate",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { name, phone, is_alternate } = (body ?? {}) as Record<string, unknown>;
  const asAlternate = is_alternate === true;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (phone != null && typeof phone !== "string") {
    return NextResponse.json({ error: "Phone must be text" }, { status: 400 });
  }

  const sessionId = parseId(id);
  if (sessionId === null) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const trimmedName = name.trim();
  const trimmedPhone = (phone as string | null | undefined)?.trim() || null;
  if (trimmedName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Name is too long" }, { status: 400 });
  }
  if (trimmedPhone && trimmedPhone.length > MAX_PHONE_LENGTH) {
    return NextResponse.json({ error: "Phone is too long" }, { status: 400 });
  }

  // The player upsert, duplicate check, capacity check and insert have to be
  // atomic. Without that, two requests racing for the last open spot both
  // read the pre-insert count, both pass, and both insert — putting the
  // session over capacity. register_signup
  // (prisma/migrations/*_add_register_signup_function) does all of it in one
  // statement after locking the session row with `SELECT ... FOR UPDATE`, so
  // concurrent signups for a session serialize. It reads the session's courts
  // under that lock (404s via 'not_found' if it doesn't exist) and never
  // changes an existing player's record on a rejected request.
  const rows = await prisma.$queryRaw<RegisterResult[]>`
    SELECT *
    FROM register_signup(
      ${sessionId}::integer,
      ${trimmedName}::text,
      ${trimmedPhone}::text,
      ${asAlternate}::boolean,
      ${PLAYERS_PER_COURT}::integer
    )`;

  const result = rows[0];
  if (!result) {
    throw new Error("register_signup returned no row");
  }

  if (result.status === "not_found") {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const conflict = CONFLICT_MESSAGES[result.status];
  if (conflict) {
    return NextResponse.json({ error: conflict }, { status: 409 });
  }

  // Same shape as a Prisma signup with `include: { player: { select:
  // publicPlayerSelect } }`; the `satisfies` checks fail to compile if the
  // Signup model or publicPlayerSelect changes without this being updated.
  // Public response: no phone. Signing up under an existing name must not
  // reveal the number already on file for it.
  const signup = {
    id: result.signup_id!,
    session_id: sessionId,
    player_id: result.player_id!,
    is_alternate: result.is_alternate!,
    signed_up_at: result.signed_up_at!,
  } satisfies Signup;
  const player = {
    id: result.player_id!,
    name: result.player_name!,
    created_at: result.player_created_at!,
  } satisfies Record<keyof typeof publicPlayerSelect, unknown>;

  return NextResponse.json({ ...signup, player }, { status: 201 });
}
