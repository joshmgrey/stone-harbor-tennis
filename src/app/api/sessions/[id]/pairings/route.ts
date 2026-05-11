import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { buildCourtPairings, shufflePlayers } from "@/lib/pairings";

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

  const { pairings: pairingData, sittingOut } = buildCourtPairings(shufflePlayers(signups));

  // Replace old pairings atomically
  const [, ...pairings] = await prisma.$transaction([
    prisma.pairing.deleteMany({ where: { session_id: Number(id) } }),
    ...pairingData.map((pairing) =>
      prisma.pairing.create({
        data: {
          session_id: Number(id),
          ...pairing,
        },
      })
    ),
  ]);

  return NextResponse.json({ pairings, sittingOut });
}
