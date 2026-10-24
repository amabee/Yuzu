import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRecordId } from "../../src/ids.js";
import { SpikeDatabase, testDatabaseUrl } from "./database.js";
import { SafetyError } from "./policy.js";

const db = new SpikeDatabase();
const code = (expected: string) => (error: unknown) =>
  error !== null &&
  typeof error === "object" &&
  "code" in error &&
  error.code === expected;
before(() => db.initialize());
after(() => db.close());
const insertChild = (
  boardId: string,
  parentId: string,
  extra: { id?: string; groupId?: string } = {},
) =>
  db.query(
    `INSERT INTO "Task" ("id","boardId","parentId","createdById","groupId") VALUES ($1,$2,$3,$4,$5) RETURNING "id"`,
    [
      extra.id ?? createRecordId(),
      boardId,
      parentId,
      "owner",
      extra.groupId ?? null,
    ],
  );
const children = async (parentId: string) =>
  Number(
    (
      await db.query(`SELECT count(*) FROM "Task" WHERE "parentId"=$1`, [
        parentId,
      ])
    ).rows[0].count,
  );
const proposalStatus = async (id: string) =>
  (await db.query(`SELECT "status" FROM "BoardProposal" WHERE "id"=$1`, [id]))
    .rows[0].status;

test("database selection fails closed and never uses development tables", () => {
  assert.throws(
    () => testDatabaseUrl("postgresql://test@localhost/yuzu", undefined),
    /Refusing/,
  );
  assert.throws(() => testDatabaseUrl(undefined, undefined), /Provide/);
  assert.equal(
    new URL(testDatabaseUrl(undefined, "postgresql://test@localhost/yuzu"))
      .pathname,
    "/yuzu_e2e",
  );
});
test("PostgreSQL rejects self, nested, cross-board, nonexistent and group-owning parents", async () => {
  const { boardId, parentId } = await db.seed();
  const other = await db.seed();
  const id = createRecordId();
  await assert.rejects(insertChild(boardId, id, { id }), code("23514"));
  await assert.rejects(insertChild(other.boardId, parentId), code("23503"));
  await assert.rejects(insertChild(boardId, createRecordId()), code("23503"));
  await assert.rejects(
    insertChild(boardId, parentId, { groupId: "forged" }),
    code("23514"),
  );
  const childId = (await insertChild(boardId, parentId)).rows[0].id;
  await assert.rejects(insertChild(boardId, childId), code("23514"));
  await assert.rejects(
    db.query(`UPDATE "Task" SET "parentId"=$2 WHERE "id"=$1`, [
      parentId,
      childId,
    ]),
    code("23514"),
  );
  assert.equal(await children(parentId), 1);
});
test("type and immutable-parent constraints apply even to direct SQL", async () => {
  for (const recordType of ["DEAL", "CUSTOM"] as const) {
    const fixture = await db.seed({ recordType });
    await assert.rejects(
      insertChild(fixture.boardId, fixture.parentId),
      code("23514"),
    );
  }
  const { boardId, parentId } = await db.seed();
  const childId = (await insertChild(boardId, parentId)).rows[0].id;
  await assert.rejects(
    db.query(`UPDATE "Task" SET "parentId"=NULL WHERE "id"=$1`, [childId]),
    code("23514"),
  );
  await assert.rejects(
    db.query(`UPDATE "Board" SET "recordType"='DEAL' WHERE "id"=$1`, [boardId]),
    code("23514"),
  );
});
test("creation proposals have typed same-board parent FKs and reject missing or mismatched JSON parents", async () => {
  const fixture = await db.seed();
  const other = await db.seed();
  const insert = (boardId: string, parentId: string, payload: unknown) =>
    db.query(
      `INSERT INTO "BoardProposal" ("id","boardId","parentTaskId","authorId","requestKey","policyVersion","changes") VALUES ($1,$2,$3,'owner',$4,1,$5)`,
      [createRecordId(), boardId, parentId, createRecordId(), payload],
    );
  await assert.rejects(
    insert(other.boardId, fixture.parentId, {
      parentId: fixture.parentId,
      name: "Child",
    }),
    code("23503"),
  );
  await assert.rejects(
    insert(fixture.boardId, fixture.parentId, { parentId: other.parentId }),
    code("23514"),
  );
  await assert.rejects(
    insert(fixture.boardId, fixture.parentId, { name: "Child" }),
    code("23514"),
  );
});
test("concurrent direct creations cannot overbook the last child slot", async () => {
  const { parentId, scope } = await db.seed();
  const outcomes = await Promise.allSettled([
    db.claim(parentId, scope, createRecordId(), "A", 1),
    db.claim(parentId, scope, createRecordId(), "B", 1),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.filter(
      (outcome) =>
        outcome.status === "rejected" && code("CAPACITY")(outcome.reason),
    ).length,
    1,
  );
  assert.equal(await children(parentId), 1);
});
test("retained archive/Trash children consume slots and the default capacity is 200", async () => {
  const { parentId, boardId, scope } = await db.seed();
  const ids = Array.from({ length: 200 }, () => createRecordId());
  await db.query(
    `INSERT INTO "Task" ("id","boardId","parentId","createdById","archivedAt","deletedAt") SELECT id,$1,$2,'owner',now(),now() FROM unnest($3::text[]) AS id`,
    [boardId, parentId, ids],
  );
  await assert.rejects(
    db.claim(parentId, scope, createRecordId()),
    code("CAPACITY"),
  );
  assert.equal(await children(parentId), 200);
});
test("pending creation reserves capacity, retries deduplicate and apply exchanges the slot", async () => {
  const { parentId, scope, boardId } = await db.seed({ requireCreation: true });
  const key = createRecordId();
  const first = await db.claim(parentId, scope, key, "A", 2);
  const replay = await db.claim(parentId, scope, key, "A", 2);
  assert.equal(replay.id, first.id);
  await assert.rejects(
    db.claim(parentId, scope, key, "Changed", 2),
    code("RETRY_CHANGED"),
  );
  await db.claim(parentId, scope, createRecordId(), "B", 2);
  assert.equal(await children(parentId), 0);
  await assert.rejects(
    db.claim(parentId, scope, createRecordId(), "C", 2),
    code("CAPACITY"),
  );
  assert.equal(
    (
      await db.approve(
        first.id,
        scope,
        db.scope(boardId, { principalId: "reviewer" }),
        2,
      )
    ).status,
    "APPROVED",
  );
  assert.equal(await children(parentId), 1);
  await assert.rejects(
    db.approve(
      first.id,
      scope,
      db.scope(boardId, { principalId: "reviewer" }),
      2,
    ),
    code("ALREADY_RESOLVED"),
  );
});
test("rejection, withdrawal and stale author permission all release reservations", async () => {
  for (const terminal of ["REJECTED", "WITHDRAWN", "STALE"] as const) {
    const { parentId, boardId, scope } = await db.seed({
      requireCreation: true,
    });
    const editor = { ...scope, principalId: "editor" };
    const pending = await db.claim(parentId, editor, createRecordId(), "A", 1);
    if (terminal === "STALE") {
      await db.query(`UPDATE "Task" SET "editorIds"='{}' WHERE "id"=$1`, [
        parentId,
      ]);
      const applied = await db.approve(
        pending.id,
        editor,
        db.scope(boardId, { principalId: "reviewer" }),
        1,
      );
      assert.equal(applied.status, "STALE");
    } else await db.finish(pending.id, terminal);
    assert.equal(await proposalStatus(pending.id), terminal);
    assert.equal(await children(parentId), 0);
    assert.equal(
      (await db.claim(parentId, scope, createRecordId(), "Replacement", 1))
        .kind,
      "proposal",
    );
  }
});
test("parent typo and independent sibling changes do not stale ordinary creation approval", async () => {
  const { parentId, boardId, scope } = await db.seed({ requireCreation: true });
  const pending = await db.claim(parentId, scope, createRecordId());
  await db.query(
    `UPDATE "Task" SET "name"='Corrected title',"revision"="revision"+1 WHERE "id"=$1`,
    [parentId],
  );
  const sibling = (await insertChild(boardId, parentId)).rows[0].id;
  await db.query(
    `UPDATE "Task" SET "name"='Sibling edit',"revision"="revision"+1 WHERE "id"=$1`,
    [sibling],
  );
  assert.equal(
    (
      await db.approve(
        pending.id,
        scope,
        db.scope(boardId, { principalId: "reviewer" }),
      )
    ).status,
    "APPROVED",
  );
  assert.equal((await db.task(parentId)).name, "Corrected title");
});
test("policy or requester changes stale requests; reviewer revocation cannot resolve them", async () => {
  const { parentId, boardId, scope } = await db.seed({ requireCreation: true });
  const reviewer = db.scope(boardId, { principalId: "reviewer" });
  const policyChanged = await db.claim(parentId, scope, createRecordId());
  await db.query(
    `UPDATE "Board" SET "policyVersion"=2,"requireCreation"=false WHERE "id"=$1`,
    [boardId],
  );
  assert.equal(
    (await db.approve(policyChanged.id, scope, reviewer)).status,
    "STALE",
  );
  await db.query(`UPDATE "Board" SET "requireCreation"=true WHERE "id"=$1`, [
    boardId,
  ]);
  const deactivated = await db.claim(parentId, scope, createRecordId());
  assert.equal(
    (await db.approve(deactivated.id, { ...scope, active: false }, reviewer))
      .status,
    "STALE",
  );
  const changedReviewer = await db.claim(parentId, scope, createRecordId());
  await db.query(
    `UPDATE "Board" SET "reviewerId"='replacement' WHERE "id"=$1`,
    [boardId],
  );
  await assert.rejects(
    db.approve(changedReviewer.id, scope, reviewer),
    code("FORBIDDEN"),
  );
  assert.equal(await proposalStatus(changedReviewer.id), "PENDING");
  assert.equal(
    (
      await db.approve(changedReviewer.id, scope, {
        ...reviewer,
        principalId: "replacement",
      })
    ).status,
    "APPROVED",
  );
});
test("concurrent approvers resolve once and create exactly one child", async () => {
  const { parentId, boardId, scope } = await db.seed({ requireCreation: true });
  const pending = await db.claim(parentId, scope, createRecordId());
  const reviewer = db.scope(boardId, { principalId: "reviewer" });
  const outcomes = await Promise.allSettled([
    db.approve(pending.id, scope, reviewer),
    db.approve(pending.id, scope, reviewer),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.filter(
      (outcome) =>
        outcome.status === "rejected" &&
        code("ALREADY_RESOLVED")(outcome.reason),
    ).length,
    1,
  );
  assert.equal(await children(parentId), 1);
  assert.equal(await proposalStatus(pending.id), "APPROVED");
});
test("parent lifecycle token catches new reservations and applying archive invalidates them", async () => {
  const { parentId, scope } = await db.seed({ requireCreation: true });
  const pending = await db.claim(parentId, scope, createRecordId());
  await assert.rejects(db.archive(parentId, scope, 0), code("STALE"));
  const current = await db.task(parentId);
  await db.archive(parentId, scope, current.childrenRevision);
  assert.equal(await proposalStatus(pending.id), "STALE");
  assert.equal(await children(parentId), 0);
  await assert.rejects(
    db.claim(parentId, scope, createRecordId()),
    code("FORBIDDEN"),
  );
});
test("parent archive versus child creation is serialized without an unnoticed new child", async () => {
  for (let i = 0; i < 6; i++) {
    const { parentId, scope } = await db.seed();
    const outcomes = await Promise.allSettled([
      db.claim(parentId, scope, createRecordId()),
      db.archive(parentId, scope, 0),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    const parent = await db.task(parentId);
    assert.equal(await children(parentId), parent.archivedAt ? 0 : 1);
  }
});
test("board archive and maintenance freeze approval without closing pending requests", async () => {
  const { parentId, boardId, scope } = await db.seed({ requireCreation: true });
  const pending = await db.claim(parentId, scope, createRecordId());
  const reviewer = db.scope(boardId, { principalId: "reviewer" });
  await db.query(`UPDATE "Board" SET "archivedAt"=now() WHERE "id"=$1`, [
    boardId,
  ]);
  await assert.rejects(
    db.approve(pending.id, scope, reviewer),
    code("FORBIDDEN"),
  );
  assert.equal(await proposalStatus(pending.id), "PENDING");
  await db.query(`UPDATE "Board" SET "archivedAt"=NULL WHERE "id"=$1`, [
    boardId,
  ]);
  await assert.rejects(
    db.approve(pending.id, scope, { ...reviewer, maintenance: true }),
    code("MAINTENANCE"),
  );
  assert.equal(await proposalStatus(pending.id), "PENDING");
  assert.equal(
    (await db.approve(pending.id, scope, reviewer)).status,
    "APPROVED",
  );
});
test("parent purge requires clearing terminal proposal references as well as children", async () => {
  const { parentId, boardId, scope } = await db.seed({ requireCreation: true });
  const other = await db.seed();
  const pending = await db.claim(parentId, scope, createRecordId());
  await db.approve(
    pending.id,
    scope,
    db.scope(boardId, { principalId: "reviewer" }),
  );
  await assert.rejects(
    db.query(`DELETE FROM "Task" WHERE "id"=$1`, [parentId]),
    code("23503"),
  );
  await db.query(`DELETE FROM "Task" WHERE "parentId"=$1`, [parentId]);
  await assert.rejects(
    db.query(`DELETE FROM "Task" WHERE "id"=$1`, [parentId]),
    code("23503"),
  );
  await db.serial(async (client) => {
    await client.query(`DELETE FROM "BoardProposal" WHERE "parentTaskId"=$1`, [
      parentId,
    ]);
    await client.query(`DELETE FROM "Task" WHERE "id"=$1`, [parentId]);
  });
  assert.equal((await db.task(other.parentId)).id, other.parentId);
});
test("failed writes roll back the child, reservation token and proposal together", async () => {
  const { parentId, boardId } = await db.seed();
  const id = createRecordId();
  await assert.rejects(
    db.serial(async (client) => {
      await client.query(`SELECT "id" FROM "Task" WHERE "id"=$1 FOR UPDATE`, [
        parentId,
      ]);
      await client.query(
        `INSERT INTO "Task" ("id","boardId","parentId","createdById") VALUES ($1,$2,$3,'owner')`,
        [id, boardId, parentId],
      );
      await client.query(
        `UPDATE "Task" SET "childrenRevision"="childrenRevision"+1 WHERE "id"=$1`,
        [parentId],
      );
      throw new SafetyError("ROLLBACK_PROOF");
    }),
    code("ROLLBACK_PROOF"),
  );
  assert.equal(await children(parentId), 0);
  assert.equal((await db.task(parentId)).childrenRevision, 0);
});
test("serialization retries are bounded rather than silently looping", async () => {
  let attempts = 0;
  await assert.rejects(
    db.serial(async () => {
      attempts++;
      throw Object.assign(new Error("Retry proof"), { code: "40001" });
    }),
    code("40001"),
  );
  assert.equal(attempts, 3);
});

test("two protected creates cannot reserve the same final slot", async () => {
  const { parentId, scope } = await db.seed({ requireCreation: true });
  const outcomes = await Promise.allSettled([
    db.claim(parentId, scope, createRecordId(), "A", 1),
    db.claim(parentId, scope, createRecordId(), "B", 1),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.filter(
      (outcome) =>
        outcome.status === "rejected" && code("CAPACITY")(outcome.reason),
    ).length,
    1,
  );
  assert.equal(await children(parentId), 0);
});
test("compatible policy version changes apply and closed request keys cannot be reopened", async () => {
  const { parentId, boardId, scope } = await db.seed({ requireCreation: true });
  const first = await db.claim(parentId, scope, createRecordId());
  await db.query(`UPDATE "Board" SET "policyVersion"=2 WHERE "id"=$1`, [
    boardId,
  ]);
  assert.equal(
    (
      await db.approve(
        first.id,
        scope,
        db.scope(boardId, { principalId: "reviewer" }),
      )
    ).status,
    "APPROVED",
  );
  const key = createRecordId();
  const rejected = await db.claim(parentId, scope, key);
  await db.finish(rejected.id, "REJECTED");
  await assert.rejects(
    db.claim(parentId, scope, key),
    code("ALREADY_RESOLVED"),
  );
});
test("root totals must filter parentId; children remain a separately counted workload", async () => {
  const { parentId, boardId, scope } = await db.seed();
  await db.claim(parentId, scope, createRecordId());
  await db.claim(parentId, scope, createRecordId());
  const counts = (
    await db.query(
      `SELECT count(*) AS flat, count(*) FILTER (WHERE "parentId" IS NULL) AS roots, count(*) FILTER (WHERE "parentId" IS NOT NULL) AS children FROM "Task" WHERE "boardId"=$1`,
      [boardId],
    )
  ).rows[0];
  assert.deepEqual(counts, { flat: "3", roots: "1", children: "2" });
});

test("typed proposals cannot target a child or non-Task board even via SQL", async () => {
  const taskBoard = await db.seed();
  const childId = (await insertChild(taskBoard.boardId, taskBoard.parentId))
    .rows[0].id;
  const dealBoard = await db.seed({ recordType: "DEAL" });
  for (const [boardId, parentId] of [
    [taskBoard.boardId, childId],
    [dealBoard.boardId, dealBoard.parentId],
  ]) {
    await assert.rejects(
      db.query(
        `INSERT INTO "BoardProposal" ("id","boardId","parentTaskId","authorId","requestKey","policyVersion","changes") VALUES ($1,$2,$3,'owner',$4,1,$5)`,
        [
          createRecordId(),
          boardId,
          parentId,
          createRecordId(),
          { parentId, name: "Child" },
        ],
      ),
      code("23514"),
    );
  }
});
test("concurrent retries reserve exactly one slot for the same request key", async () => {
  const { parentId, scope } = await db.seed({ requireCreation: true });
  const key = createRecordId();
  const outcomes = await Promise.all([
    db.claim(parentId, scope, key, "Same child", 1),
    db.claim(parentId, scope, key, "Same child", 1),
  ]);
  assert.equal(outcomes[0].id, outcomes[1].id);
  assert.equal((await db.task(parentId)).childrenRevision, 1);
  assert.equal(await children(parentId), 0);
});

test("cleanup removes only the disposable schema and preserves another running proof", async () => {
  const fixture = await db.seed();
  const isolated = new SpikeDatabase();
  try {
    await isolated.initialize();
  } finally {
    await isolated.close();
  }
  const remaining = await db.query(
    `SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname=$1`,
    [isolated.schema],
  );
  assert.equal(Number(remaining.rows[0].count), 0);
  assert.equal((await db.task(fixture.parentId)).id, fixture.parentId);
});
