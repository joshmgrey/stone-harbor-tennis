import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { PLAYERS_PER_COURT } from "@/lib/session";

const regularCount = {
  _count: { select: { signups: { where: { is_alternate: false } } } },
} as const;

type WithCount = { _count: { signups: number }; max_players?: number };
function shape<T extends WithCount>(s: T) {
  const { _count, max_players: _drop, ...rest } = s;
  return { ...rest, signup_count: _count.signups };
}

export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: [{ date: "asc" }, { start_time: "asc" }],
    include: regularCount,
  });
  return NextResponse.json(sessions.map(shape));
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { date, start_time, end_time, location, courts, notes } =
    await req.json();

  if (!date || !start_time || !end_time) {
    return NextResponse.json(
      { error: "date, start_time, and end_time are required" },
      { status: 400 }
    );
  }

  const courtCount = courts ?? 2;

  const session = await prisma.session.create({
    data: {
      date,
      start_time,
      end_time,
      location: location ?? "Stone Harbor Tennis Courts",
      courts: courtCount,
      // Derived; retained only for the deprecated column.
      max_players: courtCount * PLAYERS_PER_COURT,
      notes: notes ?? null,
    },
    include: regularCount,
  });

  return NextResponse.json(shape(session), { status: 201 });
}
