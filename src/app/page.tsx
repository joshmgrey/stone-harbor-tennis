import Link from "next/link";
import type { Session } from "@/types";

async function getSessions(): Promise<Session[]> {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const res = await fetch(`${base}/api/sessions`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

function formatDate(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${suffix}`;
}

function isFuture(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d) >= today;
}

export default async function HomePage() {
  const sessions = await getSessions();
  const upcoming = sessions.filter((s) => isFuture(s.date));
  const past = sessions.filter((s) => !isFuture(s.date));

  return (
    <div>
      {/* Hero */}
      <div className="bg-green-700 rounded-2xl text-white px-8 py-10 mb-10 shadow-lg flex flex-col sm:flex-row items-center gap-6">
        <div className="text-7xl select-none">🎾</div>
        <div>
          <h1 className="text-3xl font-black tracking-tight">Stone Harbor Invitational Tennis</h1>
          <p className="text-green-100 mt-2 text-lg">
            Welcome to the SHIT League &mdash; Stone Harbor, NJ
          </p>
          <p className="text-green-200 mt-1 text-sm">
            Sign up for a session and we&apos;ll handle the doubles pairings.
          </p>
          <a
            href="/api/calendar"
            className="inline-block mt-3 text-xs bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            📅 Subscribe to Calendar
          </a>
        </div>
      </div>

      {/* Upcoming */}
      <section className="mb-10">
        <h2 className="text-xl font-bold text-gray-800 mb-4">📅 Upcoming Sessions</h2>
        {upcoming.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
            No upcoming sessions scheduled yet. Check back soon!
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {upcoming.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        )}
      </section>

      {/* Past */}
      {past.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-gray-800 mb-4">🕐 Past Sessions</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {past.map((s) => (
              <SessionCard key={s.id} session={s} past />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SessionCard({ session: s, past }: { session: Session; past?: boolean }) {
  const spotsLeft = s.max_players - (s.signup_count ?? 0);
  const full = spotsLeft <= 0;

  return (
    <Link
      href={`/sessions/${s.id}`}
      className={`block bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition-all group ${
        past ? "opacity-60 border-gray-200" : "border-green-200 hover:border-green-400"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold text-gray-900 group-hover:text-green-700 transition-colors">
            {formatDate(s.date)}
          </div>
          <div className="text-gray-600 text-sm mt-0.5">
            {formatTime(s.start_time)} – {formatTime(s.end_time)}
          </div>
          <div className="text-gray-500 text-sm mt-1">📍 {s.location}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-500">
            {s.courts} court{s.courts !== 1 ? "s" : ""}
          </div>
          {!past && (
            <div
              className={`mt-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                full
                  ? "bg-red-100 text-red-700"
                  : spotsLeft <= 4
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-green-100 text-green-700"
              }`}
            >
              {full ? "Full" : `${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} left`}
            </div>
          )}
          <div className="text-xs text-gray-400 mt-1">
            {s.signup_count ?? 0} / {s.max_players}
          </div>
        </div>
      </div>
      {s.notes && (
        <p className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 italic">
          {s.notes}
        </p>
      )}
    </Link>
  );
}
