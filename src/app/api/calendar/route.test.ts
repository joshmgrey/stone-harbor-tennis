import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { session: { findMany: (a: unknown) => findMany(a) } },
}));

import { GET } from "./route";

const session = (over: Record<string, unknown> = {}) => ({
  id: 1,
  date: "2026-09-01",
  start_time: "18:00",
  end_time: "20:00",
  location: "Stone Harbor Courts",
  notes: "Bring a can of balls",
  ...over,
});

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([]);
});

describe("GET /api/calendar", () => {
  it("serves a downloadable text/calendar document", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="stone-harbor-tennis.ics"'
    );

    const body = await res.text();
    expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(body.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("emits no VEVENT blocks when there are no sessions", async () => {
    const body = await (await GET()).text();
    expect(body).not.toContain("BEGIN:VEVENT");
  });

  it("orders sessions by date then start time", async () => {
    await GET();
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ date: "asc" }, { start_time: "asc" }],
    });
  });

  it("renders a session as a VEVENT with TZID-anchored start/end and location", async () => {
    findMany.mockResolvedValue([session()]);

    const body = await (await GET()).text();
    // Long lines are 75-octet folded; unfold before matching field content.
    const unfolded = body.replace(/\r\n /g, "");
    expect(body).toContain("BEGIN:VEVENT");
    expect(unfolded).toContain(
      "UID:session-1@stone-harbor-invitational-tennis.org"
    );
    expect(unfolded).toContain(
      "DTSTART;TZID=America/New_York:20260901T180000"
    );
    expect(unfolded).toContain("DTEND;TZID=America/New_York:20260901T200000");
    expect(unfolded).toContain("LOCATION:Stone Harbor Courts");
    expect(unfolded).toContain(
      "DESCRIPTION:Bring a can of balls\\nSign up: https://stone-harbor-invitational-tennis.org/sessions/1"
    );
  });

  it("drops the notes segment from the description when notes are null", async () => {
    findMany.mockResolvedValue([session({ notes: null })]);

    const unfolded = (await (await GET()).text()).replace(/\r\n /g, "");
    expect(unfolded).toContain(
      "DESCRIPTION:Sign up: https://stone-harbor-invitational-tennis.org/sessions/1"
    );
  });

  it("folds lines longer than 75 octets with a CRLF + space continuation", async () => {
    const longLocation = "A".repeat(90);
    findMany.mockResolvedValue([session({ location: longLocation })]);

    const body = await (await GET()).text();
    expect(body).toContain("\r\n ");
    // The folded content is still fully recoverable once unfolded.
    expect(body.replace(/\r\n /g, "")).toContain(`LOCATION:${longLocation}`);
  });
});
