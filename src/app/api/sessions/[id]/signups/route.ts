import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { capacity } from "@/lib/session";

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
  const { name, phone, is_alternate } = await req.json();
  const asAlternate = is_alternate === true;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const sessionId = Number(id);
  // Read for capacity(); register_signup re-checks existence under the lock.
  const session = await prisma.session.findUnique({ where: { id: sessionId } });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const trimmedName = name.trim();
  const trimmedPhone = phone?.trim() || null;

  // The player upsert, duplicate check, capacity check and insert have to be
  // atomic. Without that, two requests racing for the last open spot both
  // read the pre-insert count, both pass, and both insert — putting the
  // session over capacity. register_signup
  // (prisma/migrations/*_add_register_signup_function) does all of it in one
  // statement after locking the session row with `SELECT ... FOR UPDATE`, so
  // concurrent signups for a session serialize. It never overwrites a phone
  // already on file.
  const rows = await prisma.$queryRaw<RegisterResult[]>`
    SELECT *
    FROM register_signup(
      ${sessionId}::integer,
      ${trimmedName}::text,
      ${trimmedPhone}::text,
      ${asAlternate}::boolean,
      ${capacity(session)}::integer
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

  // Public response: no phone. Signing up under an existing name must not
  // reveal the number already on file for it.
  return NextResponse.json(
    {
      id: result.signup_id,
      session_id: sessionId,
      player_id: result.player_id,
      is_alternate: result.is_alternate,
      signed_up_at: result.signed_up_at,
      player: {
        id: result.player_id,
        name: result.player_name,
        created_at: result.player_created_at,
      },
    },
    { status: 201 }
  );
}
