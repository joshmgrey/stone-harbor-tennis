import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { buildPairings } from "@/lib/pairings";
import { parseId } from "@/lib/params";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const pairings = await prisma.pairing.findMany({
    where: { session_id: id },
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

  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  // Alternates are standbys — they don't get court assignments.
  const signups = await prisma.signup.findMany({
    where: { session_id: id, is_alternate: false },
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
    prisma.pairing.deleteMany({ where: { session_id: id } }),
    ...courts.map((court) =>
      prisma.pairing.create({
        data: { session_id: id, ...court },
      })
    ),
  ]);

  return NextResponse.json({ pairings, sittingOut });
}
