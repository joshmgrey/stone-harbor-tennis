import { isAdmin } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const admin = await isAdmin();
  return NextResponse.json({ admin });
}
