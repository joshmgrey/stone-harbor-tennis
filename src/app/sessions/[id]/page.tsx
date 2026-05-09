"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Session, Signup, Pairing, Player } from "@/types";
import MapEmbed from "@/components/MapEmbed";

function formatDate(dateStr: string) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-US", {
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

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();

  const [session, setSession] = useState<Session | null>(null);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [knownPlayers, setKnownPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    const [detailRes, pairingsRes, playersRes] = await Promise.all([
      fetch(`/api/sessions/${id}`),
      fetch(`/api/sessions/${id}/pairings`),
      fetch(`/api/players`),
    ]);
    if (detailRes.ok) {
      const data = await detailRes.json();
      setSession(data.session);
      setSignups(data.signups);
    }
    if (pairingsRes.ok) {
      setPairings(await pairingsRes.json());
    }
    if (playersRes.ok) {
      setKnownPlayers(await playersRes.json());
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setName(val);
    // Auto-fill phone when an exact known player is selected
    const match = knownPlayers.find(
      (p) => p.name.toLowerCase() === val.trim().toLowerCase()
    );
    if (match?.phone) setPhone(match.phone);
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sessions/${id}/signups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
      } else {
        setSuccess(`You're signed up, ${name.trim()}! See you on the court! 🎾`);
        setName("");
        setPhone("");
        load();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-green-700 text-lg animate-pulse">Loading session…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-600 text-lg">Session not found.</p>
        <Link href="/" className="mt-4 inline-block text-green-700 hover:underline">
          ← Back to sessions
        </Link>
      </div>
    );
  }

  const spotsLeft = session.max_players - signups.length;
  const full = spotsLeft <= 0;
  const future = isFuture(session.date);

  const pairedPlayers = new Set(
    pairings.flatMap((p) => [p.team1_player1, p.team1_player2, p.team2_player1, p.team2_player2])
  );
  const sittingOut = signups.filter((s) => !pairedPlayers.has(s.name));

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/" className="text-green-700 hover:underline text-sm mb-4 inline-block">
        ← All sessions
      </Link>

      {/* Session header */}
      <div className="bg-white border border-green-200 rounded-2xl shadow-sm p-6 mb-6">
        <h1 className="text-2xl font-black text-gray-900">{formatDate(session.date)}</h1>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
          <span>🕐 {formatTime(session.start_time)} – {formatTime(session.end_time)}</span>
          <span>📍 {session.location}</span>
          <span>🎾 {session.courts} court{session.courts !== 1 ? "s" : ""}</span>
          <span>👥 {signups.length} / {session.max_players} players</span>
        </div>
        {session.notes && (
          <p className="mt-3 text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2 italic">
            {session.notes}
          </p>
        )}
        {future && (
          <div className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${
            full ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
          }`}>
            {full ? "⛔ Session Full" : `✅ ${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} remaining`}
          </div>
        )}
      </div>

      {/* Location map */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-800 mb-3">📍 Location</h2>
        <MapEmbed location={session.location} />
      </div>

      {/* Pairings */}
      {pairings.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-3">🏆 Court Assignments</h2>
          <div className="grid gap-3">
            {pairings.map((p) => (
              <div key={p.id} className="bg-white border border-yellow-200 rounded-xl p-4 shadow-sm">
                <div className="text-xs font-bold text-yellow-700 uppercase tracking-wider mb-2">
                  Court {p.court_number}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex-1 text-center">
                    <div className="font-semibold text-green-800">{p.team1_player1}</div>
                    <div className="text-green-600 text-xs">&amp;</div>
                    <div className="font-semibold text-green-800">{p.team1_player2}</div>
                  </div>
                  <div className="font-black text-gray-400 text-lg">vs</div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex-1 text-center">
                    <div className="font-semibold text-blue-800">{p.team2_player1}</div>
                    <div className="text-blue-600 text-xs">&amp;</div>
                    <div className="font-semibold text-blue-800">{p.team2_player2}</div>
                  </div>
                </div>
              </div>
            ))}
            {sittingOut.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm">
                <span className="font-semibold text-orange-700">Sitting out this round: </span>
                <span className="text-orange-600">{sittingOut.map((s) => s.name).join(", ")}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sign up form */}
      {future && !full && (
        <div className="bg-white border border-green-200 rounded-2xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Sign Up</h2>
          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                list="known-players"
                value={name}
                onChange={handleNameChange}
                required
                placeholder="Select or type your name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              <datalist id="known-players">
                {knownPlayers.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
              {knownPlayers.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  Returning player? Pick your name from the list.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(609) 555-0100"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
                {success}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-lg transition-colors text-sm"
            >
              {submitting ? "Signing up…" : "Sign Me Up! 🎾"}
            </button>
          </form>
        </div>
      )}

      {future && full && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center text-red-700 mb-6">
          <div className="font-semibold">This session is full.</div>
          <div className="text-sm mt-1">Contact the organizer if you need to be added.</div>
        </div>
      )}

      {/* Player list */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-3">Players ({signups.length})</h2>
        {signups.length === 0 ? (
          <p className="text-gray-500 text-sm">No one has signed up yet. Be the first!</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {signups.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <span className="text-gray-400 text-sm w-5 text-right shrink-0">{i + 1}.</span>
                <span className="font-medium text-gray-800">{s.name}</span>
                {s.phone && (
                  <span className="text-gray-400 text-xs ml-auto">{s.phone}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
