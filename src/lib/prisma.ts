import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrisma() {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/stone_harbor_tennis";

  // Managed Postgres (RDS) requires TLS; the server cert chain isn't pinned.
  // `?sslmode=disable` in the URL opts out — needed to run the production
  // image against a plain local Postgres.
  const ssl =
    /[?&]sslmode=disable/.test(connectionString) ||
    process.env.NODE_ENV !== "production"
      ? undefined
      : { rejectUnauthorized: false };

  const adapter = new PrismaPg({ connectionString, ssl });
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
