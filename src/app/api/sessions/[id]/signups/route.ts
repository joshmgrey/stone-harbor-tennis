import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { capacity } from "@/lib/session";

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
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      _count: { select: { signups: { where: { is_alternate: false } } } },
    },
  });

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

  if (!asAlternate && session._count.signups >= capacity(session)) {
    return NextResponse.json(
      { error: "Session is full — you can still join as an alternate" },
      { status: 409 }
    );
  }

  const signup = await prisma.signup.create({
    data: {
      session_id: sessionId,
      player_id: player.id,
      is_alternate: asAlternate,
    },
    include: { player: true },
  });

  return NextResponse.json(signup, { status: 201 });
}
