import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client";
export type DatabaseTransaction = Prisma.TransactionClient;
export { createRecordId } from "./ids";

const databaseGlobal = globalThis as unknown as {
  yuzuDatabase?: PrismaClient;
  yuzuDatabaseSchemaVersion?: string;
};
const schemaVersion = "s3-task-attachments-v1";

export function getDatabase(): PrismaClient {
  if (
    databaseGlobal.yuzuDatabase &&
    databaseGlobal.yuzuDatabaseSchemaVersion === schemaVersion &&
    databaseGlobal.yuzuDatabase.boardApprovalPolicy &&
    databaseGlobal.yuzuDatabase.boardProposal &&
    databaseGlobal.yuzuDatabase.notification &&
    databaseGlobal.yuzuDatabase.taskAttachment
  )
    return databaseGlobal.yuzuDatabase;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL must be configured.");
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 3000,
  });
  const client = new PrismaClient({ adapter });
  // Replace clients from the previous schema during development hot reload.
  if (databaseGlobal.yuzuDatabase)
    void databaseGlobal.yuzuDatabase.$disconnect();
  databaseGlobal.yuzuDatabase = client;
  databaseGlobal.yuzuDatabaseSchemaVersion = schemaVersion;
  return client;
}

export async function checkDatabase(): Promise<void> {
  const db = getDatabase();
  await db.$queryRaw`SELECT 1`;
  // Verify required feature migrations, not just TCP connectivity.
  await Promise.all([
    db.installationSettings.count(),
    db.boardApprovalPolicy.findFirst({ select: { boardId: true } }),
    db.boardProposal.findFirst({ select: { id: true } }),
    db.notification.findFirst({ select: { id: true } }),
    db.commentRevision.findFirst({ select: { id: true } }),
    db.task.findFirst({ select: { checklist: true } }),
    db.taskAttachment.findFirst({
      select: { id: true, storageProvider: true, storageBucket: true },
    }),
  ]);
}
