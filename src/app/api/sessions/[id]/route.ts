import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { publicPlayerSelect } from "@/lib/player";
import { parseId } from "@/lib/params";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      _count: { select: { signups: { where: { is_alternate: false } } } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const signups = await prisma.signup.findMany({
    where: { session_id: id },
    // Regulars first (by sign-up time), then alternates in join order.
    orderBy: [{ is_alternate: "asc" }, { signed_up_at: "asc" }],
    // Both the public session page and the admin page read this route; only
    // the organizer gets phone numbers.
    include: {
      player: (await isAdmin()) ? true : { select: publicPlayerSelect },
    },
  });

  const { _count, max_players: _drop, ...rest } = session;
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
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  // deleteMany so an already-deleted session is a 404, not a thrown P2025 / 500.
  const { count } = await prisma.session.deleteMany({ where: { id } });
  if (count === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
