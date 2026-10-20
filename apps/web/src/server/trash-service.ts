import {
  createRecordId,
  getDatabase,
  type DatabaseTransaction,
} from "@yuzu/database";
import { discardAttachmentObject } from "@yuzu/database/attachment-objects";
import { z } from "zod";
import { recordId } from "@/lib/board-contract";
import { asRecordType, resolveRecordConfig } from "@/lib/record-types";
import { trashRetentionChoices } from "@/lib/trash-contract";
import { SetupError } from "./setup/security";
import {
  isAdministrator,
  requireIdentity,
  workspaceScope,
} from "./team-access";
import { access, loadTask, serial } from "./board-service";
import { projectAccess } from "./project-access";
import { audit } from "./audit";

const db = () => getDatabase();
const notFound = () => new SetupError(404, "NOT_FOUND", "Not found.");
const managersOnly = (what: string) =>
  new SetupError(
    403,
    "FORBIDDEN",
    `Only managers and admins can delete or restore ${what}.`,
  );
type Viewer = { id: string; role: string };

/**
 * Where a viewer may see things in Trash: the normal scopes, minus the
 * "not deleted" part. Private projects stay private, even to admins.
 */
function trashBoardScope(user: Viewer) {
  return {
    OR: [
      { projectId: null, workspace: workspaceScope(user) },
      {
        project: {
          OR: [
            { visibility: "PUBLIC", workspace: workspaceScope(user) },
            {
              members: { some: { userId: user.id } },
              workspace: { archivedAt: null },
            },
          ],
        },
      },
    ],
  };
}
/** Boards the viewer manages (admins: all they can see). */
const managedBoards = (user: Viewer) =>
  isAdministrator(user.role)
    ? trashBoardScope(user)
    : {
        AND: [
          trashBoardScope(user),
          { managers: { some: { userId: user.id } } },
        ],
      };

const idInput = z.strictObject({ id: recordId });
const restoreInput = z.strictObject({
  id: recordId,
  /** Also restore the board (and project) it was on, when those are in Trash. */
  withParents: z.boolean().default(false),
});

// ---------- Records ----------

export async function deleteRecord(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const { id } = idInput.parse(input);
  return serial(async (tx) => {
    const task = await loadTask(tx, id);
    if (!task || task.deletedAt) throw notFound();
    const context = await access(tx, user.id, task.boardId, true);
    if (!context.canManage) throw managersOnly("records");
    const now = new Date();
    const updated = await tx.task.updateMany({
      where: { id, revision: task.revision, deletedAt: null },
      // A new revision makes any open editor's save conflict instead of
      // writing to a deleted record.
      data: {
        deletedAt: now,
        deletedById: user.id,
        revision: { increment: 1 },
      },
    });
    if (!updated.count)
      throw new SetupError(
        409,
        "CONFLICT",
        "This record changed. Reload it and try again.",
      );
    // Requests waiting on it can't be approved any more.
    await tx.boardProposal.updateMany({
      where: { taskId: id, status: "PENDING" },
      data: { status: "STALE", reason: "The record was deleted." },
    });
    await tx.boardEvent.create({
      data: {
        id: createRecordId(),
        boardId: task.boardId,
        actorId: user.id,
        action: "Deleted record",
        subjectId: id,
        after: { taskId: id, name: task.name },
      },
    });
    return { boardId: task.boardId, taskId: id };
  });
}

export async function restoreRecord(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = restoreInput.parse(input);
  return serial(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: body.id },
      include: {
        board: {
          select: {
            id: true,
            name: true,
            deletedAt: true,
            projectId: true,
            project: { select: { name: true, deletedAt: true } },
          },
        },
      },
    });
    if (!task?.deletedAt) throw notFound();
    if (task.board.project?.deletedAt) {
      if (!body.withParents)
        throw new SetupError(
          409,
          "PROJECT_DELETED",
          `Its project, ${task.board.project.name}, is in Trash. Restore it too.`,
        );
      await restoreProjectIn(tx, user, task.board.projectId!);
    }
    if (task.board.deletedAt) {
      if (!body.withParents)
        throw new SetupError(
          409,
          "BOARD_DELETED",
          `Its board, ${task.board.name}, is in Trash. Restore it too.`,
        );
      await restoreBoardIn(tx, user, task.board.id);
    }
    const context = await access(tx, user.id, task.boardId, true);
    if (!context.canManage) throw managersOnly("records");
    await tx.task.update({
      where: { id: task.id },
      data: {
        deletedAt: null,
        deletedById: null,
        revision: { increment: 1 },
      },
    });
    await tx.boardEvent.create({
      data: {
        id: createRecordId(),
        boardId: task.boardId,
        actorId: user.id,
        action: "Restored record",
        subjectId: task.id,
        after: { taskId: task.id, name: task.name },
      },
    });
    return { boardId: task.boardId, taskId: task.id };
  });
}

// ---------- Boards ----------

export async function deleteBoard(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const { id } = idInput.parse(input);
  return serial(async (tx) => {
    const context = await access(tx, user.id, id, true);
    if (!context.canManage) throw managersOnly("boards");
    const records = await tx.task.count({
      where: { boardId: id, deletedAt: null },
    });
    await tx.board.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await audit(tx, {
      actorId: user.id,
      action: "BOARD_DELETED",
      subject: context.board.name,
      subjectId: id,
      workspaceId: context.board.workspaceId,
      details: `${records} ${records === 1 ? "record" : "records"}`,
    });
    return { boardId: id, workspaceId: context.board.workspaceId };
  });
}

async function restoreBoardIn(
  tx: DatabaseTransaction,
  viewer: Viewer,
  id: string,
) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: viewer.id } });
  const board = await tx.board.findFirst({
    where: { id, deletedAt: { not: null }, ...managedBoards(user) },
    include: { project: { select: { name: true, deletedAt: true } } },
  });
  if (!board) throw notFound();
  if (board.project?.deletedAt)
    throw new SetupError(
      409,
      "PROJECT_DELETED",
      `Its project, ${board.project.name}, is in Trash. Restore it first.`,
    );
  await tx.board.update({
    where: { id },
    data: { deletedAt: null, deletedById: null },
  });
  await audit(tx, {
    actorId: user.id,
    action: "BOARD_RESTORED",
    subject: board.name,
    subjectId: id,
    workspaceId: board.workspaceId,
  });
  return board;
}

export async function restoreBoard(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const { id } = idInput.parse(input);
  return serial(async (tx) => {
    const board = await restoreBoardIn(tx, user, id);
    return { boardId: id, workspaceId: board.workspaceId };
  });
}

// ---------- Projects ----------

export async function deleteProject(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const { id } = idInput.parse(input);
  return serial(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    const context = await projectAccess(tx, current, id);
    if (!context.canManage) throw managersOnly("projects");
    const boards = await tx.board.count({
      where: { projectId: id, deletedAt: null },
    });
    await tx.project.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await audit(tx, {
      actorId: user.id,
      action: "PROJECT_DELETED",
      subject: context.project.name,
      subjectId: id,
      workspaceId: context.project.workspaceId,
      details: `${boards} ${boards === 1 ? "board" : "boards"}`,
    });
    return { projectId: id, workspaceId: context.project.workspaceId };
  });
}

async function restoreProjectIn(
  tx: DatabaseTransaction,
  viewer: Viewer,
  id: string,
) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: viewer.id } });
  const project = await tx.project.findFirst({
    where: {
      id,
      deletedAt: { not: null },
      workspace: { archivedAt: null },
      // Admins restore public projects; project managers restore their own.
      OR: [
        ...(isAdministrator(user.role) ? [{ visibility: "PUBLIC" }] : []),
        { members: { some: { userId: user.id, role: "MANAGER" } } },
      ],
    },
  });
  if (!project) throw notFound();
  await tx.project.update({
    where: { id },
    data: { deletedAt: null, deletedById: null },
  });
  await audit(tx, {
    actorId: user.id,
    action: "PROJECT_RESTORED",
    subject: project.name,
    subjectId: id,
    workspaceId: project.workspaceId,
  });
  return project;
}

export async function restoreProject(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const { id } = idInput.parse(input);
  return serial(async (tx) => {
    const project = await restoreProjectIn(tx, user, id);
    return { projectId: id, workspaceId: project.workspaceId };
  });
}

// ---------- Trash ----------

const LIST_LIMIT = 200;

/** What this person may restore, newest first; admins also see erase tools. */
export async function trashState(
  input: { boardId?: string | null },
  headers: Headers,
) {
  const { user, settings } = await requireIdentity(headers);
  const boardId = input.boardId ? recordId.parse(input.boardId) : null;
  return db().$transaction(async (tx) => {
    const names = new Map<string, string>();
    const [records, boards, projects] = await Promise.all([
      tx.task.findMany({
        where: {
          deletedAt: { not: null },
          ...(boardId ? { boardId } : {}),
          board: managedBoards(user),
        },
        orderBy: { deletedAt: "desc" },
        take: LIST_LIMIT,
        select: {
          id: true,
          name: true,
          deletedAt: true,
          deletedById: true,
          board: {
            select: {
              id: true,
              name: true,
              deletedAt: true,
              recordType: true,
              recordConfig: true,
              project: { select: { name: true, deletedAt: true } },
            },
          },
          _count: { select: { comments: true, attachments: true } },
        },
      }),
      boardId
        ? Promise.resolve([])
        : tx.board.findMany({
            where: { deletedAt: { not: null }, ...managedBoards(user) },
            orderBy: { deletedAt: "desc" },
            take: LIST_LIMIT,
            select: {
              id: true,
              name: true,
              deletedAt: true,
              deletedById: true,
              project: { select: { name: true, deletedAt: true } },
              workspace: { select: { name: true } },
              _count: { select: { tasks: { where: { deletedAt: null } } } },
            },
          }),
      boardId
        ? Promise.resolve([])
        : tx.project.findMany({
            where: {
              deletedAt: { not: null },
              workspace: { archivedAt: null },
              OR: [
                ...(isAdministrator(user.role)
                  ? [{ visibility: "PUBLIC" }]
                  : []),
                { members: { some: { userId: user.id, role: "MANAGER" } } },
              ],
            },
            orderBy: { deletedAt: "desc" },
            take: LIST_LIMIT,
            select: {
              id: true,
              name: true,
              deletedAt: true,
              deletedById: true,
              workspace: { select: { name: true } },
              _count: { select: { boards: { where: { deletedAt: null } } } },
            },
          }),
    ]);
    const people = await tx.user.findMany({
      where: {
        id: {
          in: [...records, ...boards, ...projects]
            .map((item) => item.deletedById)
            .filter((id): id is string => Boolean(id)),
        },
      },
      select: { id: true, name: true },
    });
    for (const person of people) names.set(person.id, person.name);
    const who = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return {
      canErase: isAdministrator(user.role),
      retentionDays: settings.trashRetentionDays,
      records: records.map((task) => ({
        id: task.id,
        name: task.name,
        recordName: resolveRecordConfig(
          asRecordType(task.board.recordType),
          task.board.recordConfig,
        ).singular,
        boardId: task.board.id,
        boardName: task.board.name,
        projectName: task.board.project?.name ?? null,
        parentDeleted: Boolean(
          task.board.deletedAt || task.board.project?.deletedAt,
        ),
        deletedAt: task.deletedAt!.toISOString(),
        deletedBy: who(task.deletedById),
        comments: task._count.comments,
        files: task._count.attachments,
      })),
      boards: boards.map((board) => ({
        id: board.id,
        name: board.name,
        workspaceName: board.workspace.name,
        projectName: board.project?.name ?? null,
        parentDeleted: Boolean(board.project?.deletedAt),
        deletedAt: board.deletedAt!.toISOString(),
        deletedBy: who(board.deletedById),
        records: board._count.tasks,
      })),
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        workspaceName: project.workspace.name,
        deletedAt: project.deletedAt!.toISOString(),
        deletedBy: who(project.deletedById),
        boards: project._count.boards,
      })),
    };
  });
}

// ---------- Erasing (admins) ----------

const eraseInput = z.strictObject({
  /** Everything in Trash, or one item. */
  all: z.boolean().default(false),
  kind: z.enum(["record", "board", "project"]).optional(),
  id: recordId.optional(),
});

/** Permanently removes records, then boards, then projects, with their files. */
async function eraseIn(
  tx: DatabaseTransaction,
  target: { taskIds: string[]; boardIds: string[]; projectIds: string[] },
) {
  const boardIds = [
    ...new Set([
      ...target.boardIds,
      ...(
        await tx.board.findMany({
          where: { projectId: { in: target.projectIds } },
          select: { id: true },
        })
      ).map((board) => board.id),
    ]),
  ];
  const taskWhere = {
    OR: [{ id: { in: target.taskIds } }, { boardId: { in: boardIds } }],
  };
  const files = await tx.taskAttachment.findMany({
    where: { task: taskWhere },
    select: { storageKey: true, storageProvider: true, storageBucket: true },
  });
  const records = await tx.task.deleteMany({ where: taskWhere });
  const settings = await tx.installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (settings?.initialBoardId && boardIds.includes(settings.initialBoardId))
    await tx.installationSettings.update({
      where: { id: "installation" },
      data: { initialBoardId: null },
    });
  const boards = await tx.board.deleteMany({ where: { id: { in: boardIds } } });
  const projects = await tx.project.deleteMany({
    where: { id: { in: target.projectIds } },
  });
  return {
    files,
    counts: {
      records: records.count,
      boards: boards.count,
      projects: projects.count,
    },
  };
}

async function finishErase(
  actorId: string | null,
  run: (tx: DatabaseTransaction) => Promise<{
    files: Parameters<typeof discardAttachmentObject>[0][];
    counts: { records: number; boards: number; projects: number };
  }>,
  why: string,
) {
  const { files, counts } = await serial(async (tx) => {
    const result = await run(tx);
    const total = itemCount(result.counts);
    if (total)
      await audit(tx, {
        actorId,
        action: "TRASH_ERASED",
        subject: `${total} ${total === 1 ? "item" : "items"}`,
        details: `${why}: ${result.counts.records} records, ${result.counts.boards} boards, ${result.counts.projects} projects, ${result.files.length} files`,
      });
    return result;
  });
  // Files go after the rows are gone; a failure leaves an orphan for the
  // attachments cleanup, never a row pointing at nothing.
  for (const file of files)
    await discardAttachmentObject(file).catch(() => undefined);
  return counts;
}
const itemCount = (value: {
  records: number;
  boards: number;
  projects: number;
}) => value.records + value.boards + value.projects;

export async function eraseTrash(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  if (!isAdministrator(user.role))
    throw new SetupError(403, "FORBIDDEN", "Only admins can erase Trash.");
  const body = eraseInput.parse(input);
  if (!body.all && !(body.kind && body.id))
    throw new SetupError(422, "INVALID_INPUT", "Choose what to erase.");
  const erased = await finishErase(
    user.id,
    async (tx) => {
      const deleted = { deletedAt: { not: null } };
      if (body.all) {
        const [tasks, boards, projects] = await Promise.all([
          tx.task.findMany({ where: deleted, select: { id: true } }),
          tx.board.findMany({ where: deleted, select: { id: true } }),
          tx.project.findMany({ where: deleted, select: { id: true } }),
        ]);
        return eraseIn(tx, {
          taskIds: tasks.map((item) => item.id),
          boardIds: boards.map((item) => item.id),
          projectIds: projects.map((item) => item.id),
        });
      }
      const found =
        body.kind === "record"
          ? await tx.task.findFirst({ where: { id: body.id, ...deleted } })
          : body.kind === "board"
            ? await tx.board.findFirst({ where: { id: body.id, ...deleted } })
            : await tx.project.findFirst({
                where: { id: body.id, ...deleted },
              });
      if (!found) throw notFound();
      return eraseIn(tx, {
        taskIds: body.kind === "record" ? [body.id!] : [],
        boardIds: body.kind === "board" ? [body.id!] : [],
        projectIds: body.kind === "project" ? [body.id!] : [],
      });
    },
    body.all ? "Emptied Trash" : "Erased from Trash",
  );
  return { erased };
}

/** Auto-erase: items deleted longer ago than the admin's chosen period. */
export async function eraseExpiredTrash(now = new Date()) {
  const settings = await db().installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (settings?.setupState !== "READY" || !settings.trashRetentionDays)
    return 0;
  const before = {
    deletedAt: {
      lt: new Date(now.getTime() - settings.trashRetentionDays * 86_400_000),
    },
  };
  const erased = await finishErase(
    null,
    async (tx) => {
      const [tasks, boards, projects] = await Promise.all([
        tx.task.findMany({ where: before, select: { id: true }, take: 1000 }),
        tx.board.findMany({ where: before, select: { id: true }, take: 100 }),
        tx.project.findMany({ where: before, select: { id: true }, take: 50 }),
      ]);
      return eraseIn(tx, {
        taskIds: tasks.map((item) => item.id),
        boardIds: boards.map((item) => item.id),
        projectIds: projects.map((item) => item.id),
      });
    },
    `Auto-erase after ${settings.trashRetentionDays} days`,
  );
  return itemCount(erased);
}

export async function setTrashRetention(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  if (!isAdministrator(user.role))
    throw new SetupError(403, "FORBIDDEN", "Only admins can set auto-erase.");
  const body = z
    .strictObject({ days: z.enum(trashRetentionChoices).nullable() })
    .parse(input);
  const days = body.days === null ? null : Number(body.days);
  await serial(async (tx) => {
    await tx.installationSettings.update({
      where: { id: "installation" },
      data: { trashRetentionDays: days, revision: { increment: 1 } },
    });
    await audit(tx, {
      actorId: user.id,
      action: "TRASH_RETENTION_SET",
      subject: days ? `${days} days` : "Never",
    });
  });
  return { retentionDays: days };
}
