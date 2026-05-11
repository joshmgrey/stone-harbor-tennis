import { describe, expect, it } from "vitest";
import { buildCalendarFeed, foldIcsLine, icalDate } from "./calendar";

describe("calendar helpers", () => {
  it("formats local session dates for iCal", () => {
    expect(icalDate("2026-07-04", "09:30")).toBe("20260704T093000");
  });

  it("folds long iCal lines using CRLF continuation lines", () => {
    const folded = foldIcsLine(`DESCRIPTION:${"a".repeat(90)}`);

    expect(folded).toContain("\r\n ");
    expect(folded.split("\r\n")[0]).toHaveLength(75);
  });

  it("builds a valid calendar feed with session details", () => {
    const feed = buildCalendarFeed([
      {
        id: 12,
        date: "2026-07-04",
        start_time: "09:00",
        end_time: "10:30",
        location: "Stone Harbor Tennis Courts",
        notes: "Bring water",
      },
    ]);

    expect(feed).toContain("BEGIN:VCALENDAR");
    expect(feed).toContain("BEGIN:VEVENT");
    expect(feed).toContain("DTSTART;TZID=America/New_York:20260704T090000");
    expect(feed).toContain("DTEND;TZID=America/New_York:20260704T103000");
    expect(feed).toContain("SUMMARY:Stone Harbor Tennis");
    expect(feed).toContain("DESCRIPTION:Bring water\\nSign up:");
    expect(feed).toContain("stone-harbor-invitational-tennis.");
    expect(feed).toContain(" org/sessions/12");
    expect(feed).toContain("END:VCALENDAR");
  });
});
