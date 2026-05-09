import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function parseDbUrl(dsn: string) {
  // Strip scheme
  const withoutScheme = dsn.replace(/^postgres(?:ql)?:\/\//, "");
  // Split on the last @ to separate userinfo from host
  const at = withoutScheme.lastIndexOf("@");
  const userInfo = withoutScheme.slice(0, at);
  const hostInfo = withoutScheme.slice(at + 1);
  // Parse user:password
  const colon = userInfo.indexOf(":");
  const user = userInfo.slice(0, colon);
  const password = decodeURIComponent(userInfo.slice(colon + 1));
  // Parse host:port/database
  const hostMatch = hostInfo.match(/^([^:/]+):(\d+)\/([^?]+)/);
  if (!hostMatch) throw new Error("Invalid DATABASE_URL format");
  return { user, password, host: hostMatch[1], port: parseInt(hostMatch[2]), database: hostMatch[3] };
}

function createPrisma() {
  const dsn =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/shit_league";
  const { user, password, host, port, database } = parseDbUrl(dsn);
  console.log("[prisma] connecting to", host, port, database, "user:", user);
  const pool = new Pool({
    user,
    password,
    host,
    port,
    database,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
