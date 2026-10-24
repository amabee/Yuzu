import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRecordId, getDatabase } from "@yuzu/database";
import {
  access,
  canEdit,
  createTaskInTransaction,
  loadTask,
  mutateTaskInTransaction,
  serial,
} from "@/server/board-service";
import {
  createSubitemInTransaction,
  listSubitemsInTransaction,
  reorderSubitemInTransaction,
  changeSubitemTrashInTransaction,
} from "@/server/subitem-service";
import { decideApprovalInTransaction } from "@/server/approval-service";
import { internalSubitemWrite } from "@/server/task-hierarchy";
import { createTaskSchema } from "@/lib/board-contract";
import { taskWhere } from "@/server/task-query";
import {
  deleteRecordInTransaction,
  eraseBatch,
  eraseSelection,
  restoreRecordInTransaction,
} from "@/server/trash-service";

const db = getDatabase();
const workspaceIds: string[] = [],
  userIds: string[] = [];
let legacy: {
  id: string;
  name: string;
  revision: number;
  createDigest: string;
}[];
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/yuzu_e2e")
    throw new Error("Refusing a non-test database.");
  legacy = await db.task.findMany({
    select: { id: true, name: true, revision: true, createDigest: true },
    take: 20,
  });
  const migrated = spawnSync("pnpm db:deploy", {
    shell: true,
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: process.env,
    stdio: "pipe",
  });
  if (migrated.status !== 0)
    throw new Error("Could not migrate isolated subitem test database.");
  await db.installationSettings.upsert({
    where: { id: "installation" },
    create: { setupState: "READY" },
    update: { setupState: "READY", maintenanceMode: false },
  });
});
afterAll(async () => {
  // Only fixtures created by this file, and only yuzu_e2e. No dev-data reset.
  await db.installationSettings.update({
    where: { id: "installation" },
    data: { maintenanceMode: false },
  });
  const boards = { board: { workspaceId: { in: workspaceIds } } };
  await db.boardProposal.deleteMany({ where: boards });
  await db.task.deleteMany({ where: { ...boards, parentId: { not: null } } });
  await db.task.deleteMany({ where: boards });
  await db.board.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
async function fixture(requireCreation = false) {
  const people = await Promise.all(
    ["owner", "editor", "reviewer", "outsider"].map((name) =>
      db.user.create({
        data: {
          name,
          email: `${createRecordId()}@subitems.test`,
          emailVerified: true,
        },
      }),
    ),
  );
  const [owner, editor, reviewer, outsider] = people;
  userIds.push(...people.map((person) => person.id));
  const workspace = await db.workspace.create({
    data: {
      name: "Subitem integration",
      createdById: owner.id,
      members: {
        create: people.slice(0, 3).map((person) => ({ userId: person.id })),
      },
    },
  });
  workspaceIds.push(workspace.id);
  const board = await db.board.create({
    data: {
      name: "Task breakdown",
      workspaceId: workspace.id,
      createdById: owner.id,
      columns: {
        create: [
          { name: "Task", key: "name", type: "TEXT", position: 0 },
          {
            name: "Status",
            key: "status",
            type: "STATUS",
            position: 1,
            config: {
              options: [
                { id: "todo", label: "To do" },
                { id: "done", label: "Done" },
              ],
            },
          },
          { name: "Assignees", key: "assignees", type: "PEOPLE", position: 2 },
          { name: "Start", key: "start_date", type: "DATE", position: 3 },
          { name: "Due", key: "due_date", type: "DATE", position: 4 },
        ],
      },
      groups: { create: { name: "Delivery", position: 0 } },
      managers: { create: { userId: reviewer.id, grantedById: owner.id } },
    },
  });
  const result = await serial((tx) =>
    createTaskInTransaction(
      tx,
      { boardId: board.id, name: "Parent", createKey: createRecordId() },
      owner.id,
    ),
  );
  if (result.outcome !== "APPLIED")
    throw new Error("Expected direct fixture creation.");
  const parentId = result.taskId;
  await db.taskEditorGrant.create({
    data: { taskId: parentId, userId: editor.id, grantedById: reviewer.id },
  });
  const status = await db.boardColumn.findFirstOrThrow({
    where: { boardId: board.id, key: "status" },
  });
  await db.boardApprovalPolicy.create({
    data: {
      boardId: board.id,
      enabled: requireCreation,
      requireCreation,
      requireChanges: true,
      protectedFieldIds: [status.id],
      primaryApproverId: reviewer.id,
    },
  });
  return {
    owner,
    editor,
    reviewer,
    outsider,
    workspace,
    boardId: board.id,
    parentId,
  };
}
const create = async (
  f: Awaited<ReturnType<typeof fixture>>,
  extra: Record<string, unknown> = {},
  userId = f.owner.id,
) =>
  serial((tx) =>
    createSubitemInTransaction(
      tx,
      {
        boardId: f.boardId,
        parentId: f.parentId,
        name: "Child",
        createKey: createRecordId(),
        ...extra,
      },
      userId,
    ),
  );
const approve = (proposalId: string, userId: string) =>
  serial((tx) =>
    decideApprovalInTransaction(
      tx,
      { proposalId, action: "approve" },
      userId,
      true,
    ),
  );
const appliedId = (result: Awaited<ReturnType<typeof create>>) => {
  if (result.outcome !== "APPLIED")
    throw new Error("Expected an applied record.");
  return result.taskId;
};
const pendingId = (result: Awaited<ReturnType<typeof create>>) => {
  if (result.outcome !== "PENDING_APPROVAL")
    throw new Error("Expected a pending proposal.");
  return result.proposalId;
};

describe("real gated subitem services", () => {
  it("preserves legacy rows and rejects ordinary API and raw database creation", async () => {
    for (const row of legacy)
      expect(
        await db.task.findUnique({
          where: { id: row.id },
          select: { id: true, name: true, revision: true, createDigest: true },
        }),
      ).toEqual(row);
    const f = await fixture();
    expect(
      createTaskSchema.safeParse({
        boardId: f.boardId,
        parentId: f.parentId,
        name: "Child",
        createKey: createRecordId(),
      }).success,
    ).toBe(false);
    await expect(
      db.task.create({
        data: {
          boardId: f.boardId,
          parentId: f.parentId,
          name: "Bypass",
          createdById: f.owner.id,
          createKey: createRecordId(),
          createDigest: "bypass",
        },
      }),
    ).rejects.toThrow();
    expect(await db.task.count({ where: { parentId: f.parentId } })).toBe(0);
  });
  it("uses current scope and inherited edit authority without copying grants", async () => {
    const f = await fixture();
    await expect(create(f, {}, f.outsider.id)).rejects.toMatchObject({
      status: 404,
    });
    const id = appliedId(await create(f, {}, f.editor.id));
    const child = await db.task.findUniqueOrThrow({
      where: { id },
      include: { editors: true },
    });
    expect(child.parentId).toBe(f.parentId);
    expect(child.groupId).toBeNull();
    expect(child.editors).toHaveLength(0);
    await serial(async (tx) => {
      const task = (await loadTask(tx, id, true))!;
      expect(canEdit(task, await access(tx, f.owner.id, f.boardId))).toBe(true);
    });
    await db.taskEditorGrant.deleteMany({
      where: { taskId: f.parentId, userId: f.editor.id },
    });
    await expect(create(f, {}, f.editor.id)).rejects.toMatchObject({
      status: 403,
    });
    expect(
      await db.taskActivity.count({
        where: { taskId: id, action: "Created subitem" },
      }),
    ).toBe(1);
  });
  it("validates dates, status, inherited group and immutable parent before accepting proposals", async () => {
    const f = await fixture(true);
    await expect(
      create(f, { startDate: "2026-12-10", dueDate: "2026-12-01" }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(create(f, { statusId: "forged" })).rejects.toMatchObject({
      status: 422,
    });
    await expect(create(f, { groupId: createRecordId() })).rejects.toThrow();
    expect(
      await db.boardProposal.count({ where: { boardId: f.boardId } }),
    ).toBe(0);
  });
  it("reserves protected creation and applies once through the real approval engine", async () => {
    const f = await fixture(true);
    const key = createRecordId();
    const proposalId = pendingId(
      await create(f, { createKey: key }, f.editor.id),
    );
    expect(pendingId(await create(f, { createKey: key }, f.editor.id))).toBe(
      proposalId,
    );
    const pending = await db.boardProposal.findUniqueOrThrow({
      where: { id: proposalId },
    });
    expect(pending.parentTaskId).toBe(f.parentId);
    expect(await db.task.count({ where: { parentId: f.parentId } })).toBe(0);
    await expect(
      serial((tx) =>
        decideApprovalInTransaction(
          tx,
          { proposalId, action: "approve" },
          f.reviewer.id,
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await db.task.update({
      where: { id: f.parentId },
      data: { name: "Parent typo fixed", revision: { increment: 1 } },
    });
    const outcomes = await Promise.allSettled([
      approve(proposalId, f.reviewer.id),
      approve(proposalId, f.reviewer.id),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await db.task.count({ where: { parentId: f.parentId } })).toBe(1);
    expect(
      (await db.boardProposal.findUniqueOrThrow({ where: { id: proposalId } }))
        .status,
    ).toBe("APPROVED");
    expect(
      await db.notification.count({
        where: { proposalId, kind: "APPROVAL_DECISION" },
      }),
    ).toBe(1);
  });
  it("stales a protected creation when the requester loses parent editing rights", async () => {
    const f = await fixture(true);
    const proposalId = pendingId(await create(f, {}, f.editor.id));
    await db.taskEditorGrant.deleteMany({
      where: { taskId: f.parentId, userId: f.editor.id },
    });
    expect((await approve(proposalId, f.reviewer.id)).status).toBe("STALE");
    expect(await db.task.count({ where: { parentId: f.parentId } })).toBe(0);
  });
  it("keeps child field updates and inherited groups safe under the normal validators", async () => {
    const f = await fixture();
    const id = appliedId(await create(f));
    const child = await db.task.findUniqueOrThrow({ where: { id } });
    await expect(
      serial((tx) =>
        mutateTaskInTransaction(
          tx,
          "update",
          { taskId: id, revision: child.revision, changes: { groupId: null } },
          f.owner.id,
          true,
        ),
      ),
    ).rejects.toMatchObject({ code: "INHERITED_GROUP" });
    await serial((tx) =>
      mutateTaskInTransaction(
        tx,
        "update",
        {
          taskId: id,
          revision: child.revision,
          changes: { name: "Updated child" },
        },
        f.owner.id,
        true,
      ),
    );
    expect((await db.task.findUniqueOrThrow({ where: { id } })).name).toBe(
      "Updated child",
    );
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: f.parentId } })).revision,
    ).toBe(1);
  });
  it("requires hierarchy tokens for parent archive and preserves own child archives", async () => {
    const f = await fixture();
    const id = appliedId(await create(f));
    await serial((tx) =>
      mutateTaskInTransaction(
        tx,
        "archive",
        { taskId: id, revision: 1 },
        f.owner.id,
        true,
      ),
    );
    const ownArchive = (await db.task.findUniqueOrThrow({ where: { id } }))
      .archivedAt;
    const parent = await db.task.findUniqueOrThrow({
      where: { id: f.parentId },
    });
    await expect(
      serial((tx) =>
        mutateTaskInTransaction(
          tx,
          "archive",
          { taskId: f.parentId, revision: parent.revision },
          f.owner.id,
        ),
      ),
    ).rejects.toMatchObject({ code: "HIERARCHY_CHANGED" });
    await serial((tx) =>
      mutateTaskInTransaction(
        tx,
        "archive",
        {
          taskId: f.parentId,
          revision: parent.revision,
          childrenRevision: parent.childrenRevision,
        },
        f.owner.id,
      ),
    );
    await expect(create(f)).rejects.toMatchObject({ code: "PARENT_ARCHIVED" });
    const archivedRoot = await db.task.findUniqueOrThrow({
      where: { id: f.parentId },
    });
    await serial((tx) =>
      mutateTaskInTransaction(
        tx,
        "restore",
        { taskId: f.parentId, revision: archivedRoot.revision },
        f.reviewer.id,
      ),
    );
    expect(
      (await db.task.findUniqueOrThrow({ where: { id } })).archivedAt,
    ).toEqual(ownArchive);
  });
  it("invalidates pending children atomically when a parent is deleted", async () => {
    const f = await fixture(true);
    const proposalId = pendingId(await create(f, {}, f.editor.id));
    const root = await db.task.findUniqueOrThrow({ where: { id: f.parentId } });
    await expect(
      serial((tx) =>
        deleteRecordInTransaction(tx, { id: f.parentId }, f.reviewer.id),
      ),
    ).rejects.toMatchObject({ code: "HIERARCHY_CHANGED" });
    await serial((tx) =>
      deleteRecordInTransaction(
        tx,
        {
          id: f.parentId,
          revision: root.revision,
          childrenRevision: root.childrenRevision,
        },
        f.reviewer.id,
      ),
    );
    expect(
      (await db.boardProposal.findUniqueOrThrow({ where: { id: proposalId } }))
        .status,
    ).toBe("STALE");
    expect(
      await db.notification.count({
        where: {
          proposalId,
          kind: "APPROVAL_DECISION",
          recipientId: f.editor.id,
        },
      }),
    ).toBe(1);
  });
  it("bounds sibling paging and keeps legacy root queries free of internal children", async () => {
    const f = await fixture();
    await serial(async (tx) => {
      await internalSubitemWrite(tx);
      await tx.task.createMany({
        data: Array.from({ length: 51 }, (_, i) => ({
          id: createRecordId(),
          boardId: f.boardId,
          parentId: f.parentId,
          name: `Child ${i}`,
          position: i,
          createdById: f.owner.id,
          createKey: createRecordId(),
          createDigest: "fixture",
        })),
      });
    });
    const first = await serial((tx) =>
      listSubitemsInTransaction(
        tx,
        { boardId: f.boardId, parentId: f.parentId },
        f.editor.id,
      ),
    );
    expect(first.items).toHaveLength(50);
    expect(first.total).toBe(51);
    const second = await serial((tx) =>
      listSubitemsInTransaction(
        tx,
        { boardId: f.boardId, parentId: f.parentId, cursor: first.nextCursor },
        f.editor.id,
      ),
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      await db.task.count({
        where: taskWhere(f.boardId, null, f.owner.id, "2026-10-24"),
      }),
    ).toBe(1);
    expect(await serial((tx) => loadTask(tx, first.items[0].id))).toBeNull();
  });
  it("does not allow writes through maintenance, deactivation or archived containers", async () => {
    const f = await fixture();
    await db.board.update({
      where: { id: f.boardId },
      data: { archivedAt: new Date() },
    });
    await expect(create(f)).rejects.toMatchObject({ code: "BOARD_ARCHIVED" });
    await db.board.update({
      where: { id: f.boardId },
      data: { archivedAt: null },
    });
    await db.user.update({
      where: { id: f.editor.id },
      data: { deactivatedAt: new Date() },
    });
    await expect(create(f, {}, f.editor.id)).rejects.toMatchObject({
      status: 404,
    });
    await db.installationSettings.update({
      where: { id: "installation" },
      data: { maintenanceMode: true },
    });
    try {
      await expect(create(f)).rejects.toMatchObject({ code: "MAINTENANCE" });
    } finally {
      await db.installationSettings.update({
        where: { id: "installation" },
        data: { maintenanceMode: false },
      });
    }
  });
  it("rejects cross-board, nested, non-Task and group-owning child rows in the real schema", async () => {
    const f = await fixture(),
      other = await fixture();
    const childId = appliedId(await create(f));
    const raw = (
      boardId: string,
      parentId: string,
      groupId: string | null = null,
    ) =>
      serial(async (tx) => {
        await internalSubitemWrite(tx);
        return tx.task.create({
          data: {
            boardId,
            parentId,
            groupId,
            name: "Invalid",
            createdById: f.owner.id,
            createKey: createRecordId(),
            createDigest: "fixture",
          },
        });
      });
    await expect(raw(other.boardId, f.parentId)).rejects.toThrow();
    await expect(raw(f.boardId, childId)).rejects.toThrow();
    const group = await db.boardGroup.findFirstOrThrow({
      where: { boardId: f.boardId },
    });
    await expect(raw(f.boardId, f.parentId, group.id)).rejects.toThrow();
    await db.board.update({
      where: { id: other.boardId },
      data: { recordType: "DEAL" },
    });
    await expect(raw(other.boardId, other.parentId)).rejects.toThrow();
  });
  it("serializes competing creates at the real 200-child cap", async () => {
    const f = await fixture();
    await serial(async (tx) => {
      await internalSubitemWrite(tx);
      await tx.task.createMany({
        data: Array.from({ length: 199 }, () => ({
          id: createRecordId(),
          boardId: f.boardId,
          parentId: f.parentId,
          name: "Retained",
          archivedAt: new Date(),
          createdById: f.owner.id,
          createKey: createRecordId(),
          createDigest: "fixture",
        })),
      });
    });
    const outcomes = await Promise.allSettled([
      create(f, { name: "A" }),
      create(f, { name: "B" }),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await db.task.count({ where: { parentId: f.parentId } })).toBe(200);
    await expect(create(f)).rejects.toMatchObject({ code: "SUBITEM_CAPACITY" });
  });
  it("reorders siblings without revisions or parent-token changes and rejects other parents", async () => {
    const f = await fixture();
    const a = appliedId(await create(f)),
      b = appliedId(await create(f)),
      c = appliedId(await create(f));
    const before = await db.task.findUniqueOrThrow({
      where: { id: f.parentId },
    });
    await serial((tx) =>
      reorderSubitemInTransaction(
        tx,
        { taskId: c, afterId: null, beforeId: a },
        f.owner.id,
      ),
    );
    const page = await serial((tx) =>
      listSubitemsInTransaction(
        tx,
        { boardId: f.boardId, parentId: f.parentId },
        f.owner.id,
      ),
    );
    expect(page.items.map((item) => item.id)).toEqual([c, a, b]);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: c } })).revision,
    ).toBe(1);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: f.parentId } }))
        .childrenRevision,
    ).toBe(before.childrenRevision);
    const other = await fixture();
    const foreign = appliedId(await create(other));
    await expect(
      serial((tx) =>
        reorderSubitemInTransaction(
          tx,
          { taskId: c, afterId: null, beforeId: foreign },
          f.owner.id,
        ),
      ),
    ).rejects.toMatchObject({ code: "SUBITEM_LIST_CHANGED" });
  });
  it("retains independent child Trash across parent deletion and bounds subtree purge", async () => {
    const f = await fixture();
    const id = appliedId(await create(f));
    await expect(
      serial((tx) =>
        changeSubitemTrashInTransaction(
          tx,
          { taskId: id, revision: 1 },
          f.owner.id,
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await serial((tx) =>
      changeSubitemTrashInTransaction(
        tx,
        { taskId: id, revision: 1 },
        f.reviewer.id,
      ),
    );
    await serial((tx) =>
      changeSubitemTrashInTransaction(
        tx,
        { taskId: id, revision: 2 },
        f.reviewer.id,
        true,
      ),
    );
    expect(
      (await db.task.findUniqueOrThrow({ where: { id } })).deletedAt,
    ).toBeNull();
    await db.boardApprovalPolicy.update({
      where: { boardId: f.boardId },
      data: { enabled: true, requireCreation: true },
    });
    const proposalId = pendingId(await create(f, {}, f.editor.id));
    const root = await db.task.findUniqueOrThrow({ where: { id: f.parentId } });
    await serial((tx) =>
      deleteRecordInTransaction(
        tx,
        {
          id: f.parentId,
          revision: root.revision,
          childrenRevision: root.childrenRevision,
        },
        f.reviewer.id,
      ),
    );
    const selection = eraseSelection(new Date(), {
      kind: "record",
      id: f.parentId,
    });
    const first = await eraseBatch(
      null,
      selection,
      "Subitem integration proof",
    );
    expect(first.erased.records).toBe(1);
    expect(first.remaining).toBe(true);
    await eraseBatch(null, selection, "Subitem integration proof");
    expect(
      await db.task.count({ where: { id: { in: [id, f.parentId] } } }),
    ).toBe(0);
    expect(
      await db.boardProposal.findUnique({ where: { id: proposalId } }),
    ).toBeNull();
  });
  it("restoring a parent leaves independently trashed children in Trash", async () => {
    const f = await fixture();
    const id = appliedId(await create(f));
    await serial((tx) =>
      changeSubitemTrashInTransaction(
        tx,
        { taskId: id, revision: 1 },
        f.reviewer.id,
      ),
    );
    const deletedChild = (await db.task.findUniqueOrThrow({ where: { id } }))
      .deletedAt;
    const root = await db.task.findUniqueOrThrow({ where: { id: f.parentId } });
    await serial((tx) =>
      deleteRecordInTransaction(
        tx,
        {
          id: f.parentId,
          revision: root.revision,
          childrenRevision: root.childrenRevision,
        },
        f.reviewer.id,
      ),
    );
    await expect(
      serial((tx) =>
        changeSubitemTrashInTransaction(
          tx,
          { taskId: id, revision: 2 },
          f.reviewer.id,
          true,
        ),
      ),
    ).rejects.toMatchObject({ code: "PARENT_UNAVAILABLE" });
    await serial((tx) =>
      restoreRecordInTransaction(tx, { id: f.parentId }, f.reviewer.id),
    );
    expect(
      (await db.task.findUniqueOrThrow({ where: { id } })).deletedAt,
    ).toEqual(deletedChild);
    expect(
      (
        await serial((tx) =>
          listSubitemsInTransaction(
            tx,
            { boardId: f.boardId, parentId: f.parentId },
            f.owner.id,
          ),
        )
      ).total,
    ).toBe(0);
  });
  it("preserves hierarchy references during identity renumbering without allowing reparenting", async () => {
    const f = await fixture();
    const childId = appliedId(await create(f));
    await db.boardApprovalPolicy.update({
      where: { boardId: f.boardId },
      data: { enabled: true, requireCreation: true },
    });
    const proposalId = pendingId(await create(f));
    const boardId = createRecordId(),
      parentId = createRecordId();
    await db.board.update({ where: { id: f.boardId }, data: { id: boardId } });
    await db.task.update({ where: { id: f.parentId }, data: { id: parentId } });
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: childId } })).parentId,
    ).toBe(parentId);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: childId } })).boardId,
    ).toBe(boardId);
    const pending = await db.boardProposal.findUniqueOrThrow({
      where: { id: proposalId },
    });
    expect(pending.parentTaskId).toBe(parentId);
    expect(pending.changes).toMatchObject({ boardId, parentId });
    expect((await approve(proposalId, f.reviewer.id)).status).toBe("APPROVED");
    await expect(
      db.task.update({ where: { id: childId }, data: { parentId: null } }),
    ).rejects.toThrow();
  });
  it("rejects stale parent delete previews and treats inherited Trash as unavailable", async () => {
    const f = await fixture();
    const childId = appliedId(await create(f));
    const old = await db.task.findUniqueOrThrow({ where: { id: f.parentId } });
    await serial((tx) =>
      mutateTaskInTransaction(
        tx,
        "update",
        {
          taskId: f.parentId,
          revision: old.revision,
          changes: { name: "Changed after preview" },
        },
        f.owner.id,
      ),
    );
    await expect(
      serial((tx) =>
        deleteRecordInTransaction(
          tx,
          {
            id: f.parentId,
            revision: old.revision,
            childrenRevision: old.childrenRevision,
          },
          f.reviewer.id,
        ),
      ),
    ).rejects.toMatchObject({ code: "HIERARCHY_CHANGED" });
    await expect(
      serial((tx) =>
        deleteRecordInTransaction(
          tx,
          {
            id: f.parentId,
            revision: old.revision,
            childrenRevision: old.childrenRevision,
          },
          f.outsider.id,
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await db.task.update({
      where: { id: f.parentId },
      data: { deletedAt: new Date() },
    });
    await expect(
      serial((tx) =>
        mutateTaskInTransaction(
          tx,
          "update",
          { taskId: childId, revision: 1, changes: { name: "Must not apply" } },
          f.owner.id,
          true,
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("rejects a CREATE parent hidden only in JSON without the typed reference", async () => {
    const f = await fixture();
    await expect(
      db.boardProposal.create({
        data: {
          boardId: f.boardId,
          authorId: f.owner.id,
          operation: "CREATE",
          requestKey: createRecordId(),
          requestDigest: "invalid",
          changes: { parentId: f.parentId },
          baseline: {},
          policySnapshot: {},
          policyVersion: 0,
        },
      }),
    ).rejects.toThrow();
  });
});
