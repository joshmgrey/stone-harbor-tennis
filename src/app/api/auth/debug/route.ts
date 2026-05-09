import { NextResponse } from "next/server";

export async function GET() {
  const pw = process.env.AUTH_SECRET;
  return NextResponse.json({
    set: pw !== undefined,
    length: pw?.length ?? 0,
    first_char: pw?.[0] ?? null,
    last_char: pw ? pw[pw.length - 1] : null,
  });
}
