import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { name, phone } = await req.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const session = await prisma.session.findUnique({
    where: { id: Number(id) },
    include: { _count: { select: { signups: true } } },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session._count.signups >= session.max_players) {
    return NextResponse.json({ error: "Session is full" }, { status: 409 });
  }

  const trimmedName = name.trim();
  const trimmedPhone = phone?.trim() || null;

  // Upsert player — add if new, update phone if a better one is now provided
  await prisma.player.upsert({
    where: { name: trimmedName },
    create: { name: trimmedName, phone: trimmedPhone },
    update: { phone: trimmedPhone ?? undefined },
  });

  const signup = await prisma.signup.create({
    data: { session_id: Number(id), name: trimmedName, phone: trimmedPhone },
  });

  return NextResponse.json(signup, { status: 201 });
}
