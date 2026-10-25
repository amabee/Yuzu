import { linkedRecords, fillRollups } from "./record-links-service";
import type { DatabaseTransaction } from "@yuzu/database";
import {
  createTaskSchema,
  fieldOptions,
  recordId,
  reorderTaskSchema,
  taskActionSchema,
} from "@/lib/board-contract";
import { needsApproval, stableJson } from "@/lib/approval-rules";
import { z } from "zod";
import { digest, SetupError } from "./setup/security";
import {
  access,
  createTaskRecord,
  eligiblePeople,
  boardRecord,
  taskInclude,
  loadTask,
  snapshot,
  canEdit,
  validateCore,
  validateValues,
  checkDateOrder,
} from "./board-service";
import {
  readApprovalPolicy,
  existingProposal,
  submitProposal,
} from "./approval-policy";
import {
  lockTaskRoot,
  checkSubitemCapacity,
  internalSubitemWrite,
  markChildrenChanged,
  unavailableTask,
  taskAvailable,
} from "./task-hierarchy";

// The root-only domain contract remains strict for imports and automation actions.
export const subitemCreateSchema = createTaskSchema
  .omit({ groupId: true })
  .extend({ parentId: recordId })
  .strict();
export async function prepareSubitemParent(
  tx: DatabaseTransaction,
  userId: string,
  boardId: string,
  parentId: string,
) {
  const context = await access(tx, userId, boardId, true);
  const parent = await lockTaskRoot(tx, parentId, boardId);
  if (parent.deletedAt) throw unavailableTask();
  if (context.board.recordType !== "TASK")
    throw new SetupError(
      422,
      "SUBITEM_TYPE",
      "Only Task boards support subitems.",
    );
  if (parent.archivedAt)
    throw new SetupError(
      403,
      "PARENT_ARCHIVED",
      "Restore the parent task before changing its breakdown.",
    );
  if (
    !(
      context.canManage ||
      parent.createdById === userId ||
      parent.assignees.some((person) => person.userId === userId) ||
      parent.editors.some((person) => person.userId === userId)
    )
  )
    throw new SetupError(
      403,
      "FORBIDDEN",
      "Editing the parent task is required to add subitems.",
    );
  await internalSubitemWrite(tx);
  return { context, parent };
}
/** The public create dispatcher supplies the current authenticated principal. */
export async function createSubitemInTransaction(
  tx: DatabaseTransaction,
  input: unknown,
  userId: string,
) {
  const body = subitemCreateSchema.parse(input);
  const { context } = await prepareSubitemParent(
    tx,
    userId,
    body.boardId,
    body.parentId,
  );
  const requestDigest = digest(stableJson(body));
  const existing = await tx.task.findUnique({
    where: {
      createdById_createKey: { createdById: userId, createKey: body.createKey },
    },
  });
  if (existing) {
    if (
      existing.parentId !== body.parentId ||
      existing.boardId !== body.boardId ||
      existing.createDigest !== requestDigest
    )
      throw new SetupError(
        409,
        "RETRY_CHANGED",
        "This creation key belongs to a different request.",
      );
    return {
      outcome: "APPLIED" as const,
      taskId: existing.id,
      revision: existing.revision,
    };
  }
  const replay = await existingProposal(
    tx,
    userId,
    body.createKey,
    requestDigest,
  );
  if (replay) return replay;
  await checkSubitemCapacity(tx, body.parentId);
  const people = new Set(
    (await eligiblePeople(tx, context.board)).map((person) => person.id),
  );
  const statusColumn = context.board.columns.find(
    (column) => column.key === "status",
  );
  const initial = {
    ...body,
    statusId:
      body.statusId === undefined
        ? boardRecord(context.board).config.builtins.status.on
          ? (fieldOptions(statusColumn?.config)[0]?.id ?? null)
          : null
        : body.statusId,
  };
  // The same core/custom validators run before a private proposal is persisted.
  checkDateOrder(initial.startDate ?? null, initial.dueDate ?? null);
  validateCore(initial, context.board, people);
  validateValues(initial.fieldValues, context.board, people);
  const policy = await readApprovalPolicy(tx, context.board);
  if (needsApproval(policy, "CREATE", initial, context.board.columns)) {
    const result = await submitProposal(tx, {
      boardId: body.boardId,
      parentTaskId: body.parentId,
      authorId: userId,
      operation: "CREATE",
      requestKey: body.createKey,
      requestDigest,
      changes: initial,
      baseline: {},
      policy,
      eligible: people,
    });
    await markChildrenChanged(tx, body.parentId);
    return result;
  }
  return createTaskRecord(
    tx,
    context,
    people,
    initial,
    userId,
    requestDigest,
    userId,
    "Created subitem",
    undefined,
    body.parentId,
  );
}
const childListSchema = z.strictObject({
  boardId: recordId,
  parentId: recordId,
  cursor: recordId.optional(),
  archived: z.boolean().default(false),
});
export async function listSubitemsInTransaction(
  tx: DatabaseTransaction,
  input: unknown,
  userId: string,
) {
  const body = childListSchema.parse(input);
  const context = await access(tx, userId, body.boardId);
  if (context.board.recordType !== "TASK") throw unavailableTask();
  const parent = await tx.task.findFirst({
    where: {
      id: body.parentId,
      boardId: body.boardId,
      parentId: null,
      deletedAt: null,
    },
    select: {
      id: true,
      archivedAt: true,
      childrenRevision: true,
      startDate: true,
      dueDate: true,
    },
  });
  if (!parent) throw unavailableTask();
  const where = {
    boardId: body.boardId,
    parentId: parent.id,
    deletedAt: null,
    archivedAt: body.archived ? { not: null } : null,
  };
  const maintenance =
    (
      await tx.installationSettings.findUnique({
        where: { id: "installation" },
        select: { maintenanceMode: true },
      })
    )?.maintenanceMode ?? true;
  const activeWhere = {
    boardId: body.boardId,
    parentId: parent.id,
    deletedAt: null,
    archivedAt: null,
  };
  const summary = {
    total: await tx.task.count({ where: activeWhere }),
    done: await tx.task.count({ where: { ...activeWhere, statusId: "done" } }),
  };
  const outsideParentDates = Boolean(
    (parent.startDate || parent.dueDate) &&
    (await tx.task.count({
      where: {
        ...activeWhere,
        OR: [
          ...(parent.startDate
            ? [{ startDate: { lt: parent.startDate } }]
            : []),
          ...(parent.dueDate ? [{ dueDate: { gt: parent.dueDate } }] : []),
        ],
      },
    })),
  );
  const total = await tx.task.count({ where });
  const done = await tx.task.count({ where: { ...where, statusId: "done" } });
  const cursor = body.cursor
    ? await tx.task.findFirst({
        where: { ...where, id: body.cursor },
        select: { id: true, position: true },
      })
    : null;
  if (body.cursor && !cursor)
    throw new SetupError(
      409,
      "SUBITEM_LIST_CHANGED",
      "This breakdown changed. Reload the subitems.",
    );
  const rows = await tx.task.findMany({
    where: {
      ...where,
      ...(cursor
        ? {
            OR: [
              { position: { gt: cursor.position } },
              { position: cursor.position, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    include: taskInclude,
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 51,
  });
  const page = rows.slice(0, 50);
  const items = page.map((task) => ({
    id: task.id,
    ...snapshot(task),
    parentId: task.parentId,
    parentName: task.parent?.name ?? null,
    createdById: task.createdById,
    createdByName: task.createdBy.name,
    position: task.position,
    commentCount: task._count.comments,
    attachmentCount: task._count.attachments,
    activity: task.activity.map((e) => ({
      id: e.id,
      action: e.action,
      actor: e.actor.name,
      createdAt: e.createdAt.toISOString(),
    })),
    revision: task.revision,
    canEdit: !maintenance && !task.archivedAt && canEdit(task, context),
  }));
  const relationIds = context.board.columns
    .filter((c) => c.type === "RELATION")
    .map((c) => c.id);
  const linked = await linkedRecords(
    tx,
    context.user,
    items.flatMap((item) =>
      relationIds.flatMap((id) =>
        Array.isArray(item.fieldValues[id]) ? item.fieldValues[id] : [],
      ),
    ),
  );
  await fillRollups(tx, context.board.columns, items, linked);
  return {
    linked,
    items,
    summary,
    outsideParentDates,
    total,
    done,
    childrenRevision: parent.childrenRevision,
    readOnly: maintenance || context.readOnly || Boolean(parent.archivedAt),
    nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
  };
}

export async function reorderSubitemInTransaction(
  tx: DatabaseTransaction,
  input: unknown,
  userId: string,
) {
  const body = reorderTaskSchema.parse(input);
  const task = await loadTask(tx, body.taskId, true);
  if (!task?.parentId || !taskAvailable(task)) throw unavailableTask();
  const context = await access(tx, userId, task.boardId, true);
  const parent = await lockTaskRoot(tx, task.parentId, task.boardId);
  if (
    parent.archivedAt ||
    parent.deletedAt ||
    task.archivedAt ||
    !canEdit(task, context)
  )
    throw new SetupError(403, "FORBIDDEN", "You cannot reorder this subitem.");
  const siblings = await tx.task.findMany({
    where: {
      parentId: task.parentId,
      deletedAt: null,
      archivedAt: null,
      id: { not: task.id },
    },
    select: { id: true, position: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 200,
  });
  const after = body.afterId
    ? siblings.findIndex((item) => item.id === body.afterId)
    : -1;
  const before = body.beforeId
    ? siblings.findIndex((item) => item.id === body.beforeId)
    : siblings.length;
  if (
    (body.afterId && after < 0) ||
    (body.beforeId && before < 0) ||
    before !== after + 1
  )
    throw new SetupError(
      409,
      "SUBITEM_LIST_CHANGED",
      "This breakdown changed. Reload its order.",
    );
  const left = siblings[after]?.position,
    right = siblings[before]?.position;
  const position =
    left !== undefined && right !== undefined
      ? (left + right) / 2
      : left !== undefined
        ? left + 1024
        : right !== undefined
          ? right - 1024
          : 1024;
  if (
    !Number.isFinite(position) ||
    (left !== undefined && position - left < 1e-6) ||
    (right !== undefined && right - position < 1e-6)
  ) {
    const ids = siblings.map((item) => item.id);
    ids.splice(before, 0, task.id);
    for (const [index, id] of ids.entries())
      await tx.task.update({
        where: { id },
        data: { position: (index + 1) * 1024 },
      });
  } else await tx.task.update({ where: { id: task.id }, data: { position } });
  return { boardId: task.boardId, taskId: task.id };
}
export async function changeSubitemTrashInTransaction(
  tx: DatabaseTransaction,
  input: unknown,
  userId: string,
  restore = false,
) {
  const body = taskActionSchema.parse(input);
  const task = await loadTask(tx, body.taskId, true);
  if (!task?.parentId) throw unavailableTask();
  const context = await access(tx, userId, task.boardId, true);
  if (!context.canManage)
    throw new SetupError(
      403,
      "FORBIDDEN",
      "Only board managers can delete or restore subitems.",
    );
  const parent = await lockTaskRoot(tx, task.parentId, task.boardId);
  if (parent.deletedAt || parent.archivedAt)
    throw new SetupError(
      409,
      "PARENT_UNAVAILABLE",
      "Restore the parent task before changing its subitems.",
    );
  if (task.revision !== body.revision)
    throw new SetupError(
      409,
      "TASK_CHANGED",
      "This subitem changed. Reload it before continuing.",
    );
  if (Boolean(task.deletedAt) !== restore) throw unavailableTask();
  await tx.task.update({
    where: { id: task.id },
    data: {
      deletedAt: restore ? null : new Date(),
      deletedById: restore ? null : userId,
      revision: { increment: 1 },
    },
  });
  await markChildrenChanged(tx, parent.id);
  if (!restore) {
    const pending = await tx.boardProposal.findMany({
      where: { taskId: task.id, status: "PENDING" },
      take: 201,
    });
    if (pending.length > 200)
      throw new SetupError(
        409,
        "SUBITEM_REQUESTS",
        "Resolve outstanding requests before deleting this subitem.",
      );
    const { finalizeProposal } = await import("./proposal-finalization");
    for (const proposal of pending)
      await finalizeProposal(
        tx,
        proposal,
        userId,
        null,
        "STALE",
        "The record was deleted.",
      );
  }
  await tx.boardEvent.create({
    data: {
      boardId: task.boardId,
      actorId: userId,
      action: restore ? "Restored subitem" : "Deleted subitem",
      subjectId: task.id,
      after: { taskId: task.id },
    },
  });
  return { boardId: task.boardId, taskId: task.id };
}

export async function subitems(input: unknown, headers: Headers) {
  const { requireIdentity } = await import("./team-access");
  const { serial } = await import("./board-service");
  const { user } = await requireIdentity(headers);
  return serial((tx) => listSubitemsInTransaction(tx, input, user.id));
}
export async function reorderSubitem(input: unknown, headers: Headers) {
  const { requireIdentity } = await import("./team-access");
  const { serial } = await import("./board-service");
  const { user } = await requireIdentity(headers);
  return serial((tx) => reorderSubitemInTransaction(tx, input, user.id));
}
