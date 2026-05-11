import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildCalendarFeed } from "@/lib/calendar";

export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: [{ date: "asc" }, { start_time: "asc" }],
  });

  return new NextResponse(buildCalendarFeed(sessions), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="stone-harbor-tennis.ics"',
    },
  });
}
