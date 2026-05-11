import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function fold(line: string): string {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) {
    chunks.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

function icalDate(date: string, time: string): string {
  const [y, m, d] = date.split("-");
  const [h, min] = time.split(":");
  return `${y}${m.padStart(2, "0")}${d.padStart(2, "0")}T${h.padStart(2, "0")}${min.padStart(2, "0")}00`;
}

export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: [{ date: "asc" }, { start_time: "asc" }],
  });

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Stone Harbor Tennis//League Calendar//EN",
    "X-WR-CALNAME:Stone Harbor Invitational Tennis",
    "X-WR-TIMEZONE:America/New_York",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const s of sessions) {
    const description = [
      s.notes,
      `Sign up: https://stone-harbor-invitational-tennis.org/sessions/${s.id}`,
    ]
      .filter(Boolean)
      .join("\\n");

    lines.push(
      "BEGIN:VEVENT",
      fold(`UID:session-${s.id}@stone-harbor-invitational-tennis.org`),
      fold(`DTSTART;TZID=America/New_York:${icalDate(s.date, s.start_time)}`),
      fold(`DTEND;TZID=America/New_York:${icalDate(s.date, s.end_time)}`),
      fold(`SUMMARY:Stone Harbor Tennis`),
      fold(`LOCATION:${s.location}`),
      fold(`DESCRIPTION:${description}`),
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");

  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="stone-harbor-tennis.ics"',
    },
  });
}
