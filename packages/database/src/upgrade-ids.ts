import { Pool } from "pg";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { v7 } from "uuid";

const uuid7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tables = [
  "User",
  "Account",
  "Workspace",
  "Board",
  "BoardColumn",
  "BoardGroup",
  "Invitation",
  "AccessEvent",
] as const;
type Counts = Record<(typeof tables)[number], number>;

/** One-time, atomic upgrade of legacy local-development IDs; preserves attribution and dates. */
export async function upgradeRecordIds(connectionString: string) {
  const target = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    !["/yuzu", "/yuzu_e2e"].includes(target.pathname)
  )
    throw new Error(
      "ID upgrade is restricted to the local yuzu or yuzu_e2e database.",
    );
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query(
      `LOCK TABLE ${[...tables, "InstallationSettings", "Session", "Verification", "WorkspaceMember"].map((table) => `"${table}"`).join(", ")} IN ACCESS EXCLUSIVE MODE`,
    );
    const counts = Object.fromEntries(
      tables.map((table) => [table, 0]),
    ) as Counts;
    for (const table of tables) {
      const children = table === "BoardColumn" || table === "BoardGroup";
      // Prisma reads TIMESTAMP columns as UTC; node-postgres otherwise assumes local time.
      const timestamp =
        table === "Invitation" || table === "AccessEvent"
          ? '"createdAt"'
          : "\"createdAt\" AT TIME ZONE 'UTC'";
      const result = await client.query<{ id: string; createdAt: Date }>(
        children
          ? `SELECT c."id", b."createdAt" AT TIME ZONE 'UTC' AS "createdAt" FROM "${table}" c JOIN "Board" b ON b."id" = c."boardId" ORDER BY b."createdAt", b."id", c."position", c."id"`
          : `SELECT "id", ${timestamp} AS "createdAt" FROM "${table}" ORDER BY "createdAt", "id"`,
      );
      const sequences = new Map<number, number>();
      for (const record of result.rows) {
        if (uuid7.test(record.id)) continue;
        const msecs = record.createdAt.getTime();
        const seq = sequences.get(msecs) ?? 0;
        sequences.set(msecs, seq + 1);
        const id = v7({ msecs, seq });
        // All declared foreign keys use ON UPDATE CASCADE.
        await client.query(`UPDATE "${table}" SET "id" = $1 WHERE "id" = $2`, [
          id,
          record.id,
        ]);
        if (table === "User")
          await client.query(
            `UPDATE "Account" SET "accountId" = $1 WHERE "providerId" = 'credential' AND "userId" = $1 AND "accountId" = $2`,
            [id, record.id],
          );
        if (table === "Workspace")
          await client.query(
            `UPDATE "InstallationSettings" SET "initialWorkspaceId" = $1 WHERE "initialWorkspaceId" = $2`,
            [id, record.id],
          );
        if (table === "Board")
          await client.query(
            `UPDATE "InstallationSettings" SET "initialBoardId" = $1 WHERE "initialBoardId" = $2`,
            [id, record.id],
          );
        counts[table]++;
      }
    }
    let sessionsCleared = 0;
    let verificationsCleared = 0;
    if (Object.values(counts).some((count) => count > 0)) {
      // Sessions and recovery payloads refer to old identity IDs; require fresh sign-in and links.
      sessionsCleared =
        (await client.query('DELETE FROM "Session"')).rowCount ?? 0;
      verificationsCleared =
        (await client.query('DELETE FROM "Verification"')).rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { converted: counts, sessionsCleared, verificationsCleared };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  config({ path: new URL("../../../.env", import.meta.url), quiet: true });
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
    console.log(
      JSON.stringify(await upgradeRecordIds(process.env.DATABASE_URL)),
    );
  } catch {
    console.error(
      "UUIDv7 upgrade could not finish. Check the local database and retry; the transaction rolls back on failure.",
    );
    process.exitCode = 1;
  }
}
