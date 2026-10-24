/** Executable database proof, never exported by @yuzu/database. */
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { createRecordId } from "../../src/ids.js";
import {
  assertCanAdd,
  assertCreationApply,
  assertReservationRoom,
  SafetyError,
  type Scope,
  type Task,
} from "./policy.js";

config({ path: new URL("../../../../.env", import.meta.url), quiet: true });
export function testDatabaseUrl(
  explicit: string | undefined,
  base: string | undefined,
) {
  if (!explicit && !base)
    throw new Error(
      "Provide a local database connection for the isolated spike.",
    );
  let url: URL;
  try {
    url = new URL(explicit ?? base!);
  } catch {
    throw new Error("Invalid local database connection.");
  }
  if (!explicit) url.pathname = "/yuzu_e2e";
  if (url.pathname !== "/yuzu_e2e")
    throw new Error("Refusing a subitems spike outside yuzu_e2e.");
  return url.toString();
}
type Parent = Task & {
  name: string;
  revision: number;
  childrenRevision: number;
  recordType: Scope["recordType"];
  policyVersion: number;
  requireCreation: boolean;
  reviewerId: string;
  boardArchivedAt: Date | null;
};
type Proposal = {
  requestKey: string;
  id: string;
  authorId: string;
  boardId: string;
  parentTaskId: string;
  policyVersion: number;
  status: string;
  changes: { parentId: string; name: string };
  appliedTaskId: string | null;
};

export class SpikeDatabase {
  readonly schema = `subitems_spike_${randomBytes(8).toString("hex")}`;
  private pool = new Pool({
    connectionString: testDatabaseUrl(
      process.env.YUZU_E2E_DATABASE_URL,
      process.env.DATABASE_URL,
    ),
    max: 6,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  private created = false;
  async initialize() {
    if (
      (await this.pool.query("SELECT current_database() AS name")).rows[0]
        .name !== "yuzu_e2e"
    )
      throw new Error("Incorrect spike database.");
    await this.pool.query(`CREATE SCHEMA "${this.schema}"`);
    this.created = true;
    const sql = await readFile(new URL("schema.sql", import.meta.url), "utf8");
    await this.query(sql);
  }
  async close() {
    try {
      // Generated exact schema only, never public or any application table.
      if (this.created && /^subitems_spike_[0-9a-f]{16}$/.test(this.schema))
        await this.pool.query(`DROP SCHEMA "${this.schema}" CASCADE`);
    } finally {
      await this.pool.end();
    }
  }
  private async client() {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT set_config('search_path', $1, false)", [
        `${this.schema},pg_catalog`,
      ]);
      return client;
    } catch (error) {
      client.release();
      throw error;
    }
  }
  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ) {
    const client = await this.client();
    try {
      return await client.query<T>(sql, values);
    } finally {
      client.release();
    }
  }
  async serial<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const client = await this.client();
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        const code = (error as { code?: string }).code;
        if (["40001", "40P01"].includes(code ?? "") && attempt < 2) continue;
        throw error;
      } finally {
        client.release();
      }
    }
  }
  async seed(
    extra: { recordType?: Scope["recordType"]; requireCreation?: boolean } = {},
  ) {
    const boardId = createRecordId(),
      parentId = createRecordId();
    await this.query(
      `INSERT INTO "Board" ("id", "recordType", "requireCreation") VALUES ($1,$2,$3)`,
      [boardId, extra.recordType ?? "TASK", extra.requireCreation ?? false],
    );
    await this.query(
      `INSERT INTO "Task" ("id","boardId","createdById","editorIds","groupId") VALUES ($1,$2,$3,$4,$5)`,
      [parentId, boardId, "owner", ["editor"], "group"],
    );
    return { boardId, parentId, scope: this.scope(boardId) };
  }
  scope(boardId: string, extra: Partial<Scope> = {}): Scope {
    return {
      boardId,
      recordType: "TASK",
      principalId: "owner",
      authorized: true,
      active: true,
      canManage: false,
      maintenance: false,
      readOnly: false,
      ...extra,
    };
  }
  private async parent(client: PoolClient, id: string, scope: Scope) {
    if (!scope.authorized || !scope.active)
      throw new SafetyError("UNAVAILABLE");
    const row = (
      await client.query<Parent>(
        `SELECT t.*, b."recordType", b."policyVersion", b."requireCreation", b."reviewerId", b."archivedAt" AS "boardArchivedAt" FROM "Task" t JOIN "Board" b ON b."id" = t."boardId" WHERE t."id" = $1 AND t."boardId" = $2 FOR UPDATE OF t`,
        [id, scope.boardId],
      )
    ).rows[0];
    if (!row) throw new SafetyError("UNAVAILABLE");
    return row;
  }
  private currentScope(scope: Scope, parent: Parent): Scope {
    return {
      ...scope,
      recordType: parent.recordType,
      readOnly: scope.readOnly || Boolean(parent.boardArchivedAt),
    };
  }
  private async occupied(client: PoolClient, parentId: string) {
    const accepted = Number(
      (
        await client.query(`SELECT count(*) FROM "Task" WHERE "parentId"=$1`, [
          parentId,
        ])
      ).rows[0].count,
    );
    const pending = Number(
      (
        await client.query(
          `SELECT count(*) FROM "BoardProposal" WHERE "parentTaskId"=$1 AND "status"='PENDING'`,
          [parentId],
        )
      ).rows[0].count,
    );
    return { accepted, pending };
  }
  async claim(
    parentId: string,
    scope: Scope,
    key: string,
    name = "Child",
    limit = 200,
  ) {
    return this.serial(async (client) => {
      const parent = await this.parent(client, parentId, scope);
      const current = this.currentScope(scope, parent);
      assertCanAdd(current, parent);
      const old = (
        await client.query(
          `SELECT "id","parentId","name" FROM "Task" WHERE "createdById"=$1 AND "createKey"=$2`,
          [scope.principalId, key],
        )
      ).rows[0];
      const pending = (
        await client.query<Proposal>(
          `SELECT * FROM "BoardProposal" WHERE "authorId"=$1 AND "requestKey"=$2`,
          [scope.principalId, key],
        )
      ).rows[0];
      if (old) {
        if (old.parentId !== parentId || old.name !== name)
          throw new SafetyError("RETRY_CHANGED");
        return { kind: "task", id: old.id as string };
      }
      if (pending) {
        if (pending.parentTaskId !== parentId || pending.changes.name !== name)
          throw new SafetyError("RETRY_CHANGED");
        if (pending.status !== "PENDING")
          throw new SafetyError("ALREADY_RESOLVED");
        return { kind: "proposal", id: pending.id };
      }
      const count = await this.occupied(client, parentId);
      assertReservationRoom(count.accepted, count.pending, limit);
      const id = createRecordId();
      if (parent.requireCreation)
        await client.query(
          `INSERT INTO "BoardProposal" ("id","boardId","parentTaskId","authorId","requestKey","policyVersion","changes") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            id,
            parent.boardId,
            parent.id,
            scope.principalId,
            key,
            parent.policyVersion,
            { parentId, name },
          ],
        );
      else
        await client.query(
          `INSERT INTO "Task" ("id","boardId","parentId","name","createdById","createKey") VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, parent.boardId, parentId, name, scope.principalId, key],
        );
      await client.query(
        `UPDATE "Task" SET "childrenRevision"="childrenRevision"+1 WHERE "id"=$1`,
        [parentId],
      );
      return { kind: parent.requireCreation ? "proposal" : "task", id };
    });
  }
  async approve(id: string, author: Scope, reviewer: Scope, limit = 200) {
    return this.serial(async (client) => {
      if (!reviewer.authorized || !reviewer.active)
        throw new SafetyError("FORBIDDEN");
      const original = (
        await client.query<Proposal>(
          `SELECT * FROM "BoardProposal" WHERE "id"=$1 AND "boardId"=$2`,
          [id, reviewer.boardId],
        )
      ).rows[0];
      if (!original) throw new SafetyError("UNAVAILABLE");
      const parent = await this.parent(client, original.parentTaskId, reviewer);
      const pending = (
        await client.query<Proposal>(
          `SELECT * FROM "BoardProposal" WHERE "id"=$1 FOR UPDATE`,
          [id],
        )
      ).rows[0]!;
      try {
        assertCreationApply(
          { ...pending, payloadParentId: pending.changes.parentId },
          parent,
          this.currentScope(author, parent),
          this.currentScope(reviewer, parent),
          parent.policyVersion,
          parent.reviewerId,
          parent.requireCreation,
        );
      } catch (error) {
        if (!(error instanceof SafetyError) || error.code !== "STALE")
          throw error;
        await client.query(
          `UPDATE "BoardProposal" SET "status"='STALE' WHERE "id"=$1`,
          [id],
        );
        await client.query(
          `UPDATE "Task" SET "childrenRevision"="childrenRevision"+1 WHERE "id"=$1`,
          [parent.id],
        );
        return { status: "STALE", taskId: null };
      }
      const count = await this.occupied(client, parent.id);
      assertReservationRoom(count.accepted, count.pending, limit, true);
      const taskId = createRecordId();
      await client.query(
        `INSERT INTO "Task" ("id","boardId","parentId","name","createdById","createKey") VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          taskId,
          pending.boardId,
          pending.parentTaskId,
          pending.changes.name,
          pending.authorId,
          pending.requestKey,
        ],
      );
      await client.query(
        `UPDATE "BoardProposal" SET "status"='APPROVED',"appliedTaskId"=$2 WHERE "id"=$1`,
        [id, taskId],
      );
      await client.query(
        `UPDATE "Task" SET "childrenRevision"="childrenRevision"+1 WHERE "id"=$1`,
        [parent.id],
      );
      return { status: "APPROVED", taskId };
    });
  }
  async finish(id: string, status: "WITHDRAWN" | "REJECTED") {
    return this.serial(async (client) => {
      const pending = (
        await client.query<Proposal>(
          `SELECT * FROM "BoardProposal" WHERE "id"=$1`,
          [id],
        )
      ).rows[0]!;
      await client.query(`SELECT "id" FROM "Task" WHERE "id"=$1 FOR UPDATE`, [
        pending.parentTaskId,
      ]);
      const result = await client.query(
        `UPDATE "BoardProposal" SET "status"=$2 WHERE "id"=$1 AND "status"='PENDING' RETURNING "id"`,
        [id, status],
      );
      if (!result.rowCount) throw new SafetyError("ALREADY_RESOLVED");
      await client.query(
        `UPDATE "Task" SET "childrenRevision"="childrenRevision"+1 WHERE "id"=$1`,
        [pending.parentTaskId],
      );
    });
  }
  async archive(parentId: string, scope: Scope, expected: number) {
    return this.serial(async (client) => {
      const parent = await this.parent(client, parentId, scope);
      assertCanAdd(this.currentScope(scope, parent), parent);
      if (parent.childrenRevision !== expected) throw new SafetyError("STALE");
      await client.query(
        `UPDATE "Task" SET "archivedAt"=now(),"revision"="revision"+1 WHERE "id"=$1`,
        [parentId],
      );
      const closed = await client.query(
        `UPDATE "BoardProposal" SET "status"='STALE' WHERE "parentTaskId"=$1 AND "status"='PENDING' RETURNING "id"`,
        [parentId],
      );
      if (closed.rowCount)
        await client.query(
          `UPDATE "Task" SET "childrenRevision"="childrenRevision"+1 WHERE "id"=$1`,
          [parentId],
        );
    });
  }
  async task(id: string) {
    return (
      await this.query<Parent>(`SELECT * FROM "Task" WHERE "id"=$1`, [id])
    ).rows[0]!;
  }
}
