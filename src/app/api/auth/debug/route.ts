import { NextResponse } from "next/server";

function parseDbUrl(dsn: string) {
  try {
    const withoutScheme = dsn.replace(/^postgres(?:ql)?:\/\//, "");
    const at = withoutScheme.lastIndexOf("@");
    const userInfo = withoutScheme.slice(0, at);
    const hostInfo = withoutScheme.slice(at + 1);
    const colon = userInfo.indexOf(":");
    const user = userInfo.slice(0, colon);
    const hostMatch = hostInfo.match(/^([^:/]+):(\d+)\/([^?]+)/);
    return {
      ok: true,
      user,
      host: hostMatch?.[1] ?? null,
      port: hostMatch?.[2] ?? null,
      database: hostMatch?.[3] ?? null,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function GET() {
  const pw = process.env.AUTH_SECRET;
  const db = process.env.DATABASE_URL;
  return NextResponse.json({
    auth_secret: { set: pw !== undefined, length: pw?.length ?? 0 },
    database_url: { set: db !== undefined, parsed: db ? parseDbUrl(db) : null },
    node_env: process.env.NODE_ENV,
  });
}
