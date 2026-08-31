import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { buildPairings } from "@/lib/pairings";

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
  // Alternates are standbys — they don't get court assignments.
  const signups = await prisma.signup.findMany({
    where: { session_id: Number(id), is_alternate: false },
    orderBy: { signed_up_at: "asc" },
    include: { player: true },
  });

  if (signups.length < 4) {
    return NextResponse.json(
      { error: "Need at least 4 players to generate pairings" },
      { status: 400 }
    );
  }

  const { pairings: courts, sittingOut } = buildPairings(
    signups.map((s) => s.player.name)
  );

  // Replace old pairings atomically
  const [, ...pairings] = await prisma.$transaction([
    prisma.pairing.deleteMany({ where: { session_id: Number(id) } }),
    ...courts.map((court) =>
      prisma.pairing.create({
        data: { session_id: Number(id), ...court },
      })
    ),
  ]);

  return NextResponse.json({ pairings, sittingOut });
}
