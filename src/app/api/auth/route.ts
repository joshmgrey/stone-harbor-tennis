import { NextRequest, NextResponse } from "next/server";
import { cookieName, adminToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const secret = process.env.AUTH_SECRET;
  // With no secret configured, `undefined !== undefined` is false, so a body
  // without a password would log in. Refuse instead.
  if (!secret || password !== secret) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName(), adminToken(), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(cookieName());
  return res;
}
