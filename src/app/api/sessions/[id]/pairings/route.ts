import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pairings = await prisma.pairing.findMany({
    where: { session_id: Number(id) },
    orderBy: { court_number: "asc" },
  });
  return NextResponse.json(pairings);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const signups = await prisma.signup.findMany({
    where: { session_id: Number(id) },
    orderBy: { signed_up_at: "asc" },
    include: { player: true },
  });

  if (signups.length < 4) {
    return NextResponse.json(
      { error: "Need at least 4 players to generate pairings" },
      { status: 400 }
    );
  }

  // Fisher-Yates shuffle
  const players = [...signups];
  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }

  const courts = Math.floor(players.length / 4);
  const sittingOut = players.slice(courts * 4).map((p) => p.player.name);

  // Replace old pairings atomically
  const [, ...pairings] = await prisma.$transaction([
    prisma.pairing.deleteMany({ where: { session_id: Number(id) } }),
    ...Array.from({ length: courts }, (_, i) =>
      prisma.pairing.create({
        data: {
          session_id: Number(id),
          court_number: i + 1,
          team1_player1: players[i * 4].player.name,
          team1_player2: players[i * 4 + 1].player.name,
          team2_player1: players[i * 4 + 2].player.name,
          team2_player2: players[i * 4 + 3].player.name,
        },
      })
    ),
  ]);

  return NextResponse.json({ pairings, sittingOut });
}
