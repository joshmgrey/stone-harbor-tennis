import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await prisma.session.findUnique({
    where: { id: Number(id) },
    include: { _count: { select: { signups: true } } },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const signups = await prisma.signup.findMany({
    where: { session_id: Number(id) },
    orderBy: { signed_up_at: "asc" },
    include: { player: true },
  });

  const { _count, ...rest } = session;
  return NextResponse.json({
    session: { ...rest, signup_count: _count.signups },
    signups,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await prisma.session.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
