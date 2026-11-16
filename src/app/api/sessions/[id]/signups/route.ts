import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLAYERS_PER_COURT } from "@/lib/session";
import { publicPlayerSelect } from "@/lib/player";

/** Outcome reported by the `register_signup` PL/pgSQL function. */
type RegisterStatus =
  | "created"
  | "not_found"
  | "already_playing"
  | "already_alternate"
  | "full";

type RegisterResult = { status: RegisterStatus; signup_id: number | null };

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
  // Checked up front so a bad session id doesn't create a player row.
  // register_signup re-checks under the row lock.
  const session = await prisma.session.findUnique({ where: { id: sessionId } });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const trimmedName = name.trim();
  const trimmedPhone = phone?.trim() || null;

  const player = await prisma.player.upsert({
    where: { name: trimmedName },
    create: { name: trimmedName, phone: trimmedPhone },
    update: { phone: trimmedPhone ?? undefined },
  });

  // The duplicate check, capacity check and insert have to be atomic. Without
  // that, two requests racing for the last open spot both read the pre-insert
  // count, both pass, and both insert — putting the session over capacity.
  // register_signup (prisma/migrations/*_add_register_signup_function) does
  // all three in one statement after locking the session row with
  // `SELECT ... FOR UPDATE`, so concurrent signups for a session serialize.
  const [result] = await prisma.$queryRaw<RegisterResult[]>`
    SELECT status, signup_id
    FROM register_signup(
      ${sessionId}::integer,
      ${player.id}::integer,
      ${asAlternate}::boolean,
      ${PLAYERS_PER_COURT}::integer
    )`;

  if (result.status === "not_found") {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const conflict = CONFLICT_MESSAGES[result.status];
  if (conflict) {
    return NextResponse.json({ error: conflict }, { status: 409 });
  }

  const signup = await prisma.signup.findUnique({
    where: { id: result.signup_id! },
    // Public response: no phone. Signing up under an existing name must
    // not reveal the number already on file for it.
    include: { player: { select: publicPlayerSelect } },
  });

  return NextResponse.json(signup, { status: 201 });
}
