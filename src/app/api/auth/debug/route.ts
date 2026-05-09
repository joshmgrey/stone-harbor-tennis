import { NextResponse } from "next/server";

export async function GET() {
  const pw = process.env.AUTH_SECRET;
  const db = process.env.DATABASE_URL;
  return NextResponse.json({
    auth_secret: { set: pw !== undefined, length: pw?.length ?? 0 },
    database_url: { set: db !== undefined, starts_with: db?.slice(0, 20) ?? null },
  });
}
