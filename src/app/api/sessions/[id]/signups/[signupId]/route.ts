import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; signupId: string }> }
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { signupId } = await params;
  await prisma.signup.delete({ where: { id: Number(signupId) } });
  return NextResponse.json({ ok: true });
}

// Admin: move a signup between regular and alternate. No capacity check —
// the admin is expected to demote someone first if the roster is full.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; signupId: string }> }
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { signupId } = await params;
  const { is_alternate } = await req.json();

  if (typeof is_alternate !== "boolean") {
    return NextResponse.json(
      { error: "is_alternate must be a boolean" },
      { status: 400 }
    );
  }

  const signup = await prisma.signup.update({
    where: { id: Number(signupId) },
    data: { is_alternate },
    include: { player: true },
  });
  return NextResponse.json(signup);
}
