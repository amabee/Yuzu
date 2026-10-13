import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client";
export type DatabaseTransaction = Prisma.TransactionClient;

const databaseGlobal = globalThis as unknown as { yuzuDatabase?: PrismaClient };

export function getDatabase(): PrismaClient {
  if (databaseGlobal.yuzuDatabase) return databaseGlobal.yuzuDatabase;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL must be configured.");
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 3000,
  });
  const client = new PrismaClient({ adapter });
  databaseGlobal.yuzuDatabase = client;
  return client;
}

export async function checkDatabase(): Promise<void> {
  const db = getDatabase();
  await db.$queryRaw`SELECT 1`;
  // Verify the initial migration, not just TCP connectivity.
  await db.installationSettings.count();
}
