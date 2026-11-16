import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { parseId } from "@/lib/params";

/** Generous cap so a phone field can't be used to store arbitrary blobs. */
const MAX_PHONE_LENGTH = 32;

// Admin: set or clear a player's phone. The public signup form never changes
// a phone already on file (anyone can type any name), so this is the only way
// to update one.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const playerId = parseId((await params).id);
  if (playerId === null) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const phone = (body as { phone?: unknown } | null)?.phone;
  if (phone !== null && typeof phone !== "string") {
    return NextResponse.json(
      { error: "phone must be text, or null to clear it" },
      { status: 400 }
    );
  }
  const trimmed = phone?.trim() || null;
  if (trimmed && trimmed.length > MAX_PHONE_LENGTH) {
    return NextResponse.json({ error: "Phone is too long" }, { status: 400 });
  }

  const { count } = await prisma.player.updateMany({
    where: { id: playerId },
    data: { phone: trimmed },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  return NextResponse.json({ id: playerId, phone: trimmed });
}
