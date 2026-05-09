import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";

export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: [{ date: "asc" }, { start_time: "asc" }],
    include: { _count: { select: { signups: true } } },
  });
  return NextResponse.json(
    sessions.map((s) => {
      const { _count, ...rest } = s;
      return { ...rest, signup_count: _count.signups };
    })
  );
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { date, start_time, end_time, location, courts, max_players, notes } =
    await req.json();

  if (!date || !start_time || !end_time) {
    return NextResponse.json(
      { error: "date, start_time, and end_time are required" },
      { status: 400 }
    );
  }

  const session = await prisma.session.create({
    data: {
      date,
      start_time,
      end_time,
      location: location ?? "Stone Harbor Tennis Courts",
      courts: courts ?? 2,
      max_players: max_players ?? 16,
      notes: notes ?? null,
    },
    include: { _count: { select: { signups: true } } },
  });

  const { _count, ...rest } = session;
  return NextResponse.json({ ...rest, signup_count: _count.signups }, { status: 201 });
}
