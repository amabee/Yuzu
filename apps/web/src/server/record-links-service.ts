import { after } from "next/server";
import {
  createRecordId,
  getDatabase,
  type DatabaseTransaction,
} from "@yuzu/database";
import { z } from "zod";
import {
  aggregateLinks,
  LINK_OPTIONS_LIMIT,
  MAX_LINKS_PER_FIELD,
  relationConfig,
  relationFieldInput,
  rollupConfig,
  rollupFieldInput,
  type LinkedRecord,
} from "@/lib/record-links";
import { numberConfig } from "@/lib/record-types";
import { escapeLike } from "@/lib/board-query";
import { recordId } from "@/lib/board-contract";
import { boardScope, requireIdentity } from "./team-access";
import { SetupError } from "./setup/security";
import { notifyBoardMutation } from "./realtime";
import { access, boardRecord } from "./board-service";

type Viewer = { id: string; role: string };
type Column = {
  id: string;
  boardId: string;
  name: string;
  type: string;
  config: unknown;
};

const invalid = (message: string) =>
  new SetupError(422, "INVALID_LINK", message);

/**
 * Sets a record's links through one "Link to board" field. Links to records
 * the viewer can't see are kept untouched; new links must be visible and
 * unarchived; one-or-many limits hold on both sides. Runs inside the caller's
 * transaction, so it commits or rolls back with the record change.
 */
export async function syncLinks(
  tx: DatabaseTransaction,
  taskId: string,
  field: Column,
  input: unknown,
  viewer: Viewer,
) {
  const config = relationConfig(field.config);
  if (!config) throw invalid("This link field is broken. Recreate it.");
  const requested = [
    ...new Set(
      z
        .array(recordId)
        .max(MAX_LINKS_PER_FIELD)
        .parse(input ?? []),
    ),
  ];
  const primaryId = config.primary ? field.id : config.mirrorFieldId;
  const rows = await tx.recordLink.findMany({
    where: config.primary
      ? { fieldId: primaryId, fromId: taskId }
      : { fieldId: primaryId, toId: taskId },
    select: { id: true, fromId: true, toId: true },
  });
  const other = (row: { fromId: string; toId: string }) =>
    config.primary ? row.toId : row.fromId;
  const existing = new Set(rows.map(other));
  const user = await tx.user.findUniqueOrThrow({ where: { id: viewer.id } });
  const visible = new Map(
    (
      await tx.task.findMany({
        where: {
          id: { in: [...new Set([...requested, ...existing])] },
          boardId: config.targetBoardId,
          board: boardScope(user),
        },
        select: { id: true, name: true, archivedAt: true },
      })
    ).map((task) => [task.id, task]),
  );
  for (const id of requested) {
    const target = visible.get(id);
    // Existing private links come back as-is from the client: keep them.
    if (!target && existing.has(id)) continue;
    if (!target)
      throw invalid("Choose records you can see on the linked board.");
    if (!existing.has(id) && target.archivedAt)
      throw invalid(`${target.name} is archived. Restore it before linking.`);
  }
  // Links the viewer can't see stay as they are.
  const kept = [...existing].filter((id) => !visible.has(id));
  const final = new Set([
    ...requested.filter((id) => visible.has(id)),
    ...kept,
  ]);
  if (!config.many && final.size > 1)
    throw invalid(`${field.name} links to one record.`);
  const added = [...final].filter((id) => !existing.has(id));
  const removed = rows.filter((row) => !final.has(other(row)));
  if (!added.length && !removed.length) return;
  const mirror = await tx.boardColumn.findUnique({
    where: { id: config.mirrorFieldId },
  });
  if (added.length && mirror && !relationConfig(mirror.config)?.many) {
    // The other side links to one: each added record must be free.
    const taken = await tx.recordLink.findFirst({
      where: config.primary
        ? { fieldId: primaryId, toId: { in: added }, fromId: { not: taskId } }
        : { fieldId: primaryId, fromId: { in: added }, toId: { not: taskId } },
      select: { fromId: true, toId: true },
    });
    if (taken) {
      const name = visible.get(
        config.primary ? taken.toId : taken.fromId,
      )?.name;
      throw new SetupError(
        409,
        "LINK_TAKEN",
        `${name ?? "That record"} is already linked to another record through ${mirror.name}.`,
      );
    }
  }
  if (removed.length)
    await tx.recordLink.deleteMany({
      where: { id: { in: removed.map((row) => row.id) } },
    });
  if (added.length)
    await tx.recordLink.createMany({
      data: added.map((id) => ({
        id: createRecordId(),
        fieldId: primaryId,
        fromId: config.primary ? taskId : id,
        toId: config.primary ? id : taskId,
        createdById: viewer.id,
      })),
    });
  // The other records get an activity line, without a revision change.
  const events = [
    ...added.map((id) => ({ id, action: "Linked record" })),
    ...removed.map((row) => ({ id: other(row), action: "Unlinked record" })),
  ];
  await tx.boardEvent.createMany({
    data: events.map((event) => ({
      id: createRecordId(),
      boardId: config.targetBoardId,
      actorId: viewer.id,
      action: event.action,
      subjectId: event.id,
      after: { taskId: event.id, otherId: taskId },
    })),
  });
  // Refresh the other board once this request has answered.
  after(() => notifyBoardMutation({ boardId: config.targetBoardId }));
}

/** Names of linked records the viewer may see; the rest stay private. */
export async function linkedRecords(
  tx: DatabaseTransaction,
  viewer: Viewer,
  ids: string[],
): Promise<Record<string, LinkedRecord>> {
  if (!ids.length) return {};
  const user = await tx.user.findUniqueOrThrow({ where: { id: viewer.id } });
  const rows = await tx.task.findMany({
    where: {
      id: { in: [...new Set(ids)].slice(0, 5000) },
      board: boardScope(user),
    },
    select: { id: true, name: true, boardId: true, archivedAt: true },
  });
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        name: row.name,
        boardId: row.boardId,
        archived: Boolean(row.archivedAt),
      },
    ]),
  );
}

/**
 * Fills rollup fields for a page of records: counts or sums over the linked
 * records the viewer can see. One bounded query per summed field.
 */
export async function fillRollups(
  tx: DatabaseTransaction,
  columns: Column[],
  records: { fieldValues: Record<string, unknown> }[],
  linked: Record<string, LinkedRecord>,
) {
  for (const column of columns) {
    if (column.type !== "ROLLUP") continue;
    const config = rollupConfig(column.config);
    if (!config) continue;
    const idsOf = (record: { fieldValues: Record<string, unknown> }) => {
      const value = record.fieldValues[config.relationFieldId];
      return Array.isArray(value) ? (value as string[]) : [];
    };
    let numbers: Record<string, number> = {};
    if (config.aggregate === "sum" && config.targetFieldId) {
      const ids = [
        ...new Set(records.flatMap(idsOf).filter((id) => linked[id])),
      ];
      numbers = Object.fromEntries(
        (
          await tx.taskFieldValue.findMany({
            where: {
              fieldId: config.targetFieldId,
              taskId: { in: ids.slice(0, 10_000) },
            },
            select: { taskId: true, numberValue: true },
          })
        ).map((row) => [row.taskId, row.numberValue ?? 0]),
      );
    }
    for (const record of records)
      record.fieldValues[column.id] = aggregateLinks(
        idsOf(record),
        linked,
        config,
        numbers,
      );
  }
}

/** Records the viewer may link through a field, matching a search. */
export async function linkOptions(
  input: { fieldId: unknown; q?: unknown },
  headers: Headers,
) {
  const { user } = await requireIdentity(headers);
  const fieldId = recordId.parse(input.fieldId);
  const q = z
    .string()
    .trim()
    .max(200)
    .default("")
    .parse(input.q ?? "");
  return getDatabase().$transaction(async (tx) => {
    const field = await tx.boardColumn.findUnique({ where: { id: fieldId } });
    const config = field && relationConfig(field.config);
    if (!field || field.archivedAt || !config)
      throw new SetupError(404, "NOT_FOUND", "Link field not found.");
    // The viewer must see the field's own board as well as the target.
    await access(tx, user.id, field.boardId);
    const options = await tx.task.findMany({
      where: {
        boardId: config.targetBoardId,
        board: boardScope(user),
        archivedAt: null,
        ...(q
          ? { name: { contains: escapeLike(q), mode: "insensitive" as const } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: LINK_OPTIONS_LIMIT,
      select: { id: true, name: true },
    });
    return { options };
  });
}

/** Boards in the same workspace a link field could point at. */
export async function linkTargets(boardId: string, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return getDatabase().$transaction(async (tx) => {
    const context = await access(tx, user.id, recordId.parse(boardId));
    const boards = await tx.board.findMany({
      where: {
        workspaceId: context.board.workspaceId,
        ...boardScope(context.user),
      },
      orderBy: { name: "asc" },
      take: 200,
      select: {
        id: true,
        name: true,
        recordType: true,
        recordConfig: true,
        managers: { where: { userId: user.id }, select: { userId: true } },
        columns: {
          where: { type: "NUMBER", archivedAt: null },
          select: { id: true, name: true, config: true },
        },
      },
    });
    return {
      boards: boards.map((board) => ({
        id: board.id,
        name: board.name,
        plural: boardRecord(board).config.plural,
        canManage:
          ["OWNER", "ADMIN"].includes(context.user.role) ||
          board.managers.length > 0,
        numberFields: board.columns.map((column) => ({
          id: column.id,
          name: column.name,
        })),
      })),
    };
  });
}

/** Creates a link field and its mirror on the other board, together. */
export async function createRelationField(
  tx: DatabaseTransaction,
  context: Awaited<ReturnType<typeof access>>,
  name: string,
  input: unknown,
  position: (boardColumns: { position: number }[]) => number,
) {
  const body = relationFieldInput.parse(input);
  const target = await access(tx, context.user.id, body.targetBoardId, true);
  if (!target.canManage)
    throw new SetupError(
      403,
      "FORBIDDEN",
      "You need to manage the other board too, since its mirror field is added there.",
    );
  if (target.board.workspaceId !== context.board.workspaceId)
    throw invalid("Link to a board in the same workspace.");
  const primaryId = createRecordId();
  const mirrorId = createRecordId();
  const sameBoard = target.board.id === context.board.id;
  await tx.boardColumn.create({
    data: {
      id: primaryId,
      boardId: context.board.id,
      name,
      type: "RELATION",
      key: `custom_${primaryId}`,
      position: position(context.board.columns),
      config: {
        targetBoardId: target.board.id,
        many: body.many,
        mirrorFieldId: mirrorId,
        primary: true,
      },
    },
  });
  await tx.boardColumn.create({
    data: {
      id: mirrorId,
      boardId: target.board.id,
      name: body.mirrorName,
      type: "RELATION",
      key: `custom_${mirrorId}`,
      position: position(target.board.columns) + (sameBoard ? 1 : 0),
      config: {
        targetBoardId: context.board.id,
        many: body.mirrorMany,
        mirrorFieldId: primaryId,
        primary: false,
      },
    },
  });
  if (!sameBoard)
    after(() => notifyBoardMutation({ boardId: target.board.id }));
  return { id: primaryId };
}

/** Validates a new rollup against its link field and the summed field. */
export async function rollupColumnConfig(
  tx: DatabaseTransaction,
  context: Awaited<ReturnType<typeof access>>,
  input: unknown,
) {
  const body = rollupFieldInput.parse(input);
  const relation = context.board.columns.find(
    (column) =>
      column.id === body.relationFieldId &&
      column.type === "RELATION" &&
      !column.archivedAt,
  );
  const link = relation && relationConfig(relation.config);
  if (!link) throw invalid("Choose a link field on this board to roll up.");
  if (body.aggregate === "count")
    return { ...body, targetFieldId: null, format: "plain" as const };
  const target = body.targetFieldId
    ? await tx.boardColumn.findFirst({
        where: {
          id: body.targetFieldId,
          boardId: link.targetBoardId,
          type: "NUMBER",
          archivedAt: null,
        },
      })
    : null;
  if (!target)
    throw invalid("Choose a number field on the linked board to sum.");
  const display = numberConfig(target.config);
  return {
    ...body,
    format: display.format,
    ...(display.decimals !== undefined ? { decimals: display.decimals } : {}),
  };
}

/** Removing a link field removes its mirror, its links and rollups over it. */
export async function removeRelationField(
  tx: DatabaseTransaction,
  field: Column,
) {
  const config = relationConfig(field.config);
  if (!config) return [];
  const ids = [field.id, config.mirrorFieldId];
  await tx.recordLink.deleteMany({
    where: { fieldId: config.primary ? field.id : config.mirrorFieldId },
  });
  const rollups = await tx.boardColumn.findMany({
    where: {
      type: "ROLLUP",
      archivedAt: null,
      boardId: { in: [field.boardId, config.targetBoardId] },
    },
    select: { id: true, config: true },
  });
  const dependent = rollups
    .filter((rollup) =>
      ids.includes(rollupConfig(rollup.config)?.relationFieldId ?? ""),
    )
    .map((rollup) => rollup.id);
  await tx.boardColumn.updateMany({
    where: { id: { in: [...ids, ...dependent] } },
    data: { archivedAt: new Date() },
  });
  if (config.targetBoardId !== field.boardId)
    after(() => notifyBoardMutation({ boardId: config.targetBoardId }));
  return ids;
}
