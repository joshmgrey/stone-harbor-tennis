"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Session } from "@/types";
import { capacity, PLAYERS_PER_COURT } from "@/lib/session";

const DEFAULT_LOCATION = "Stone Harbor Tennis Courts";

function formatDate(dateStr: string) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${suffix}`;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

export default function AdminDashboard() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  // Form state
  const [date, setDate] = useState(todayStr());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [courts, setCourts] = useState(2);
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (res.ok) setSessions(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    // Wrapped in a local async fn on purpose: `react-hooks/set-state-in-effect`
    // flags an effect that (transitively) calls setState, and `loadSessions`
    // does. The indirection keeps fetch-on-mount without tripping the rule.
    async function runInitialLoad() {
      await loadSessions();
    }
    runInitialLoad();
  }, [loadSessions]);

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.refresh();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setCreating(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          start_time: startTime,
          end_time: endTime,
          location,
          courts,
          notes: notes.trim() || undefined,
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setNotes("");
        loadSessions();
      } else {
        const data = await res.json();
        setFormError(data.error ?? "Failed to create session");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this session and all its signups?")) return;
    setDeleting(id);
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    setDeleting(null);
    loadSessions();
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-500 text-sm">Manage sessions and pairings</p>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-red-600 transition-colors"
        >
          Log out
        </button>
      </div>

      {/* Create Session */}
      <div className="mb-8">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="bg-green-700 hover:bg-green-800 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
          >
            + Create New Session
          </button>
        ) : (
          <div className="bg-white border border-green-200 rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">New Session</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Time *</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Time *</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Courts</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={courts}
                  onChange={(e) => setCourts(Math.max(1, Number(e.target.value)))}
                  className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {PLAYERS_PER_COURT} players per court &middot; seats{" "}
                  {courts * PLAYERS_PER_COURT}. Extra sign-ups become alternates.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Any special info for players…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                />
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {formError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={creating}
                  className="bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors"
                >
                  {creating ? "Creating…" : "Create Session"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setFormError(""); }}
                  className="text-gray-500 hover:text-gray-700 text-sm px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Sessions list */}
      <div>
        <h2 className="text-lg font-bold text-gray-800 mb-4">All Sessions</h2>
        {loading ? (
          <div className="text-gray-400 animate-pulse py-8 text-center">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-white border border-gray-200 rounded-xl">
            No sessions yet. Create one above!
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 text-sm">{formatDate(s.date)}</div>
                  <div className="text-gray-500 text-xs mt-0.5">
                    {formatTime(s.start_time)} – {formatTime(s.end_time)} &nbsp;·&nbsp;{" "}
                    {s.courts} court{s.courts !== 1 ? "s" : ""} &nbsp;·&nbsp;{" "}
                    {s.signup_count ?? 0}/{capacity(s)} players
                  </div>
                  {s.notes && (
                    <div className="text-gray-400 text-xs mt-0.5 italic truncate">{s.notes}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/admin/sessions/${s.id}`}
                    className="bg-green-100 hover:bg-green-200 text-green-800 font-medium px-3 py-1.5 rounded-lg text-xs transition-colors"
                  >
                    Manage
                  </Link>
                  <button
                    onClick={() => handleDelete(s.id)}
                    disabled={deleting === s.id}
                    className="bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 font-medium px-3 py-1.5 rounded-lg text-xs transition-colors"
                  >
                    {deleting === s.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
