import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { capacity } from "@/lib/session";

/** Thrown inside the signup transaction when the session has no room left. */
class SessionFullError extends Error {}

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

  // This form is unauthenticated, so a name that's already on the list can't
  // change its own spot — that would let anyone move a player between playing
  // and alternate. The organizer moves people (admin PATCH).
  const existing = await prisma.signup.findFirst({
    where: { session_id: sessionId, player_id: player.id },
  });
  if (existing) {
    return NextResponse.json(
      {
        error: existing.is_alternate
          ? "You're already on the alternate list. Ask the organizer if a spot opens up."
          : "You're already signed up to play this session.",
      },
      { status: 409 }
    );
  }

  // The capacity check and the insert have to be atomic. Without that, two
  // requests racing for the last open spot both read the pre-insert count,
  // both pass the check, and both insert — putting the session over capacity.
  // Same single-transaction pattern as src/app/api/sessions/[id]/pairings/route.ts:
  // `SELECT ... FOR UPDATE` locks the session row so concurrent signups for
  // this session serialize, and the count below then sees every committed
  // signup rather than a stale snapshot.
  try {
    const signup = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${sessionId} FOR UPDATE`;

      if (!asAlternate) {
        const taken = await tx.signup.count({
          where: { session_id: sessionId, is_alternate: false },
        });
        if (taken >= capacity(session)) {
          throw new SessionFullError();
        }
      }

      return tx.signup.create({
        data: {
          session_id: sessionId,
          player_id: player.id,
          is_alternate: asAlternate,
        },
        include: { player: true },
      });
    });

    return NextResponse.json(signup, { status: 201 });
  } catch (err) {
    if (err instanceof SessionFullError) {
      return NextResponse.json(
        { error: "Session is full — you can still join as an alternate" },
        { status: 409 }
      );
    }
    throw err;
  }
}
