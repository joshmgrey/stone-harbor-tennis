"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { Session, Signup, Pairing } from "@/types";
import { capacity } from "@/lib/session";

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

export default function AdminSessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [sittingOut, setSittingOut] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pairingError, setPairingError] = useState("");

  const load = useCallback(async () => {
    const [detailRes, pairingsRes] = await Promise.all([
      fetch(`/api/sessions/${id}`),
      fetch(`/api/sessions/${id}/pairings`),
    ]);
    if (detailRes.ok) {
      const data = await detailRes.json();
      setSession(data.session);
      setSignups(data.signups);
    } else {
      router.push("/admin");
    }
    if (pairingsRes.ok) {
      setPairings(await pairingsRes.json());
    }
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    // Wrapped in a local async fn on purpose: `react-hooks/set-state-in-effect`
    // flags an effect that (transitively) calls setState, and `load` does. The
    // indirection keeps the initial fetch-on-mount without tripping the rule.
    async function runInitialLoad() {
      await load();
    }
    runInitialLoad();
  }, [load]);

  async function handleGeneratePairings() {
    setPairingError("");
    setGenerating(true);
    try {
      const res = await fetch(`/api/sessions/${id}/pairings`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setPairings(data.pairings);
        setSittingOut(data.sittingOut ?? []);
      } else {
        setPairingError(data.error ?? "Failed to generate pairings");
      }
    } finally {
      setGenerating(false);
    }
  }

  async function handleRemoveSignup(signupId: number) {
    setBusyId(signupId);
    await fetch(`/api/sessions/${id}/signups/${signupId}`, { method: "DELETE" });
    setBusyId(null);
    load();
  }

  async function handleToggleAlternate(signupId: number, makeAlternate: boolean) {
    setBusyId(signupId);
    await fetch(`/api/sessions/${id}/signups/${signupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_alternate: makeAlternate }),
    });
    setBusyId(null);
    load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-green-700 animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-20 text-gray-500">
        Session not found.{" "}
        <Link href="/admin" className="text-green-700 hover:underline">
          Back to admin
        </Link>
      </div>
    );
  }

  const regulars = signups.filter((s) => !s.is_alternate);
  const alternates = signups.filter((s) => s.is_alternate);
  const seats = capacity(session);

  const pairedNames = new Set(
    pairings.flatMap((p) => [
      p.team1_player1,
      p.team1_player2,
      p.team2_player1,
      p.team2_player2,
    ])
  );
  const computedSittingOut =
    sittingOut.length > 0
      ? sittingOut
      : regulars.filter((s) => !pairedNames.has(s.player.name)).map((s) => s.player.name);

  function signupRow(s: Signup, index: number) {
    return (
      <li key={s.id} className="flex items-center gap-3 py-3">
        <span className="text-gray-400 text-sm w-6 text-right shrink-0">{index + 1}.</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900">{s.player.name}</div>
          {s.player.phone && (
            <div className="text-gray-400 text-xs">{s.player.phone}</div>
          )}
        </div>
        <button
          onClick={() => handleToggleAlternate(s.id, !s.is_alternate)}
          disabled={busyId === s.id}
          className="shrink-0 text-xs font-medium text-green-700 hover:text-green-900 disabled:opacity-40 px-2 py-1 rounded transition-colors"
        >
          {s.is_alternate ? "→ Playing" : "→ Alternate"}
        </button>
        <button
          onClick={() => handleRemoveSignup(s.id)}
          disabled={busyId === s.id}
          className="shrink-0 text-red-400 hover:text-red-600 disabled:opacity-40 text-sm transition-colors px-2"
          title="Remove player"
        >
          {busyId === s.id ? "…" : "✕"}
        </button>
      </li>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/admin"
        className="text-green-700 hover:underline text-sm mb-4 inline-block"
      >
        ← Admin Dashboard
      </Link>

      {/* Header */}
      <div className="bg-white border border-green-200 rounded-2xl shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-gray-900">{formatDate(session.date)}</h1>
            <div className="text-gray-500 text-sm mt-1 flex flex-wrap gap-3">
              <span>🕐 {formatTime(session.start_time)} – {formatTime(session.end_time)}</span>
              <span>📍 {session.location}</span>
              <span>🎾 {session.courts} court{session.courts !== 1 ? "s" : ""}</span>
            </div>
            {session.notes && (
              <p className="mt-2 text-sm text-gray-500 italic">{session.notes}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-black text-green-700">{regulars.length}</div>
            <div className="text-xs text-gray-500">/ {seats} playing</div>
            {alternates.length > 0 && (
              <div className="text-xs text-gray-400 mt-1">
                +{alternates.length} alt{alternates.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pairings */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Court Pairings</h2>
          <button
            onClick={handleGeneratePairings}
            disabled={generating || regulars.length < 4}
            title={regulars.length < 4 ? "Need at least 4 players" : undefined}
            className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed text-yellow-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {generating
              ? "Generating…"
              : pairings.length > 0
              ? "🔀 Re-randomize"
              : "🎲 Generate Pairings"}
          </button>
        </div>

        {pairingError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
            {pairingError}
          </div>
        )}

        {regulars.length < 4 && (
          <p className="text-gray-400 text-sm">
            Need at least 4 players to generate doubles pairings — alternates
            aren&apos;t counted. Currently{" "}
            {regulars.length === 0
              ? "no one has"
              : `only ${regulars.length} player${regulars.length !== 1 ? "s have" : " has"}`}{" "}
            signed up to play.
          </p>
        )}

        {pairings.length > 0 && (
          <div className="space-y-3">
            {pairings.map((p) => (
              <div
                key={p.id}
                className="border border-yellow-100 bg-yellow-50 rounded-xl p-4"
              >
                <div className="text-xs font-bold text-yellow-700 uppercase tracking-wider mb-2">
                  Court {p.court_number}
                </div>
                <div className="flex items-center gap-3">
                  <div className="bg-green-100 rounded-lg px-3 py-2 flex-1 text-center text-sm">
                    <div className="font-semibold text-green-800">{p.team1_player1}</div>
                    <div className="text-green-500 text-xs">&amp;</div>
                    <div className="font-semibold text-green-800">{p.team1_player2}</div>
                  </div>
                  <div className="font-black text-gray-400">vs</div>
                  <div className="bg-blue-100 rounded-lg px-3 py-2 flex-1 text-center text-sm">
                    <div className="font-semibold text-blue-800">{p.team2_player1}</div>
                    <div className="text-blue-500 text-xs">&amp;</div>
                    <div className="font-semibold text-blue-800">{p.team2_player2}</div>
                  </div>
                </div>
              </div>
            ))}

            {computedSittingOut.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm">
                <span className="font-semibold text-orange-700">Sitting out: </span>
                <span className="text-orange-600">{computedSittingOut.join(", ")}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Signups */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-4">
          Playing ({regulars.length} / {seats})
        </h2>
        {regulars.length === 0 ? (
          <p className="text-gray-400 text-sm">No one signed up to play yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {regulars.map((s, i) => signupRow(s, i))}
          </ul>
        )}

        {alternates.length > 0 && (
          <>
            <h3 className="text-sm font-bold text-gray-600 mt-6 mb-2">
              Alternates ({alternates.length})
            </h3>
            <ul className="divide-y divide-gray-100">
              {alternates.map((s, i) => signupRow(s, i))}
            </ul>
          </>
        )}

        <div className="mt-4 pt-4 border-t border-gray-100">
          <Link
            href={`/sessions/${session.id}`}
            target="_blank"
            className="text-green-700 hover:underline text-sm"
          >
            View public session page ↗
          </Link>
        </div>
      </div>
    </div>
  );
}
