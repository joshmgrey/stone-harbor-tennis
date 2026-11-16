import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";
import { parseId } from "@/lib/params";

type Params = { params: Promise<{ id: string; signupId: string }> };

/**
 * The signup id and its session id from the URL, or null if either is
 * malformed. Both are used so a signup is only touched through its own
 * session's URL.
 */
async function parseIds(params: Params["params"]) {
  const { id, signupId } = await params;
  const sessionId = parseId(id);
  const signup = parseId(signupId);
  return sessionId === null || signup === null ? null : { sessionId, signupId: signup };
}

const notFound = () =>
  NextResponse.json({ error: "Signup not found" }, { status: 404 });

export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ids = await parseIds(params);
  if (!ids) return notFound();

  // deleteMany so a signup that's already gone (e.g. removed in another tab)
  // or belongs to a different session is a 404, not a thrown P2025 / 500.
  const { count } = await prisma.signup.deleteMany({
    where: { id: ids.signupId, session_id: ids.sessionId },
  });
  if (count === 0) return notFound();
  return NextResponse.json({ ok: true });
}

// Admin: move a signup between regular and alternate. No capacity check —
// the admin is expected to demote someone first if the roster is full.
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ids = await parseIds(params);
  if (!ids) return notFound();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const is_alternate = (body as { is_alternate?: unknown } | null)?.is_alternate;

  if (typeof is_alternate !== "boolean") {
    return NextResponse.json(
      { error: "is_alternate must be a boolean" },
      { status: 400 }
    );
  }

  // One atomic update that also returns the row. The extra session_id filter
  // scopes it to the URL's session; no match (gone, or another session's
  // signup) throws P2025, which is a 404.
  try {
    const signup = await prisma.signup.update({
      where: { id: ids.signupId, session_id: ids.sessionId },
      data: { is_alternate },
      include: { player: true },
    });
    return NextResponse.json(signup);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return notFound();
    }
    throw err;
  }
}
