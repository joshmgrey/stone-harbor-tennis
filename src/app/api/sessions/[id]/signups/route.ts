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

  // One signup per player per session — a repeat just changes the type.
  const existing = await prisma.signup.findFirst({
    where: { session_id: sessionId, player_id: player.id },
  });

  if (existing?.is_alternate === asAlternate) {
    return NextResponse.json(
      await prisma.signup.findUniqueOrThrow({
        where: { id: existing.id },
        include: { player: true },
      })
    );
  }

  // Past the no-op early return, a non-alternate request means a new regular
  // or an alternate moving up — both take a capped seat.
  if (!asAlternate && session._count.signups >= capacity(session)) {
    return NextResponse.json(
      { error: "Session is full — you can still join as an alternate" },
      { status: 409 }
    );
  }

  const signup = existing
    ? await prisma.signup.update({
        where: { id: existing.id },
        data: { is_alternate: asAlternate },
        include: { player: true },
      })
    : await prisma.signup.create({
        data: {
          session_id: sessionId,
          player_id: player.id,
          is_alternate: asAlternate,
        },
        include: { player: true },
      });

  return NextResponse.json(signup, { status: existing ? 200 : 201 });
}
