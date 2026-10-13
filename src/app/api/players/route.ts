import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicPlayerSelect } from "@/lib/player";

export async function GET() {
  // Public: the signup form's name autocomplete. No phone numbers.
  const players = await prisma.player.findMany({
    select: publicPlayerSelect,
    orderBy: { name: "asc" },
  });
  return NextResponse.json(players);
}
