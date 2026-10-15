import { savedViewSchema } from "@/lib/saved-view-contract";
import {
  createRecordId,
  getDatabase,
  type DatabaseTransaction,
} from "@yuzu/database";
import { z } from "zod";
import {
  readApprovalPolicy,
  existingProposal,
  submitProposal,
} from "./approval-policy";
import {
  needsApproval,
  stableJson,
  actualApprovalChanges,
} from "@/lib/approval-rules";
import type { TaskMutationResult } from "@/lib/approval-contract";
import { createNotifications } from "./notification-events";
import { mentionPresent } from "@/lib/comment-mentions";
import { commentChangeSchema } from "@/lib/board-contract";
import { checklistSchema, removeGroupSchema } from "@/lib/board-contract";
import {
  boardCreateSchema,
  boardManagerSchema,
  configureFieldSchema,
  removeFieldSchema,
  personId,
  priorities,
  commentCreateSchema,
  renameGroupSchema,
  coreKeys,
  createTaskSchema,
  editorGrantSchema,
  fieldOptions,
  fieldSchema,
  groupSchema,
  taskActionSchema,
  updateTaskSchema,
  dateOnly,
  type BoardState,
  type FieldValue,
} from "@/lib/board-contract";
import {
  requireIdentity,
  isAdministrator,
  workspaceScope,
} from "./team-access";
import { digest, SetupError } from "./setup/security";

const db = getDatabase;
const notFound = () =>
  new SetupError(
    404,
    "NOT_FOUND",
    "This board or task is not available to you.",
  );
const conflict = () =>
  new SetupError(
    409,
    "TASK_CHANGED",
    "This task changed since you opened it. Reload the current task before editing again.",
  );
export async function serial<T>(
  operation: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++)
    try {
      return await db().$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        ["P2034", "P2002"].includes(String(error.code)) &&
        attempt < 2
      )
        continue;
      throw error;
    }
}
export async function access(
  tx: DatabaseTransaction,
  userId: string,
  boardId: string,
  write = false,
) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound();
  const board = await tx.board.findFirst({
    where: { id: boardId, workspace: workspaceScope(user) },
    include: {
      managers: true,
      columns: { where: { archivedAt: null }, orderBy: { position: "asc" } },
      groups: { orderBy: { position: "asc" } },
    },
  });
  if (!board) throw notFound();
  if (
    write &&
    (
      await tx.installationSettings.findUnique({
        where: { id: "installation" },
      })
    )?.maintenanceMode
  )
    throw new SetupError(
      503,
      "MAINTENANCE",
      "Changes are paused during maintenance.",
    );
  return {
    user,
    board,
    canManage:
      isAdministrator(user.role) ||
      board.managers.some((manager) => manager.userId === user.id),
  };
}
export async function eligiblePeople(
  tx: DatabaseTransaction,
  workspaceId: string,
) {
  return tx.user.findMany({
    where: {
      OR: [
        { role: { in: ["OWNER", "ADMIN"] } },
        { memberships: { some: { workspaceId } } },
      ],
    },
    select: { id: true, name: true, image: true },
    orderBy: { name: "asc" },
  });
}
function ensurePeople(ids: string[], eligible: Set<string>) {
  if (ids.some((id) => !eligible.has(id)))
    throw new SetupError(
      422,
      "INVALID_PERSON",
      "Choose people who currently have access to this workspace.",
    );
}
function options(board: { columns: { key: string; config: unknown }[] }) {
  return fieldOptions(
    board.columns.find((field) => field.key === "status")?.config,
  );
}
export function validateCore(
  changes: {
    statusId?: string | null;
    groupId?: string | null;
    assigneeIds?: string[];
  },
  board: Awaited<ReturnType<typeof access>>["board"],
  eligible: Set<string>,
) {
  if (
    changes.statusId != null &&
    !options(board).some((option) => option.id === changes.statusId)
  )
    throw new SetupError(
      422,
      "INVALID_STATUS",
      "Choose a saved status option from this board.",
    );
  if (
    changes.groupId != null &&
    !board.groups.some((group) => group.id === changes.groupId)
  )
    throw new SetupError(
      422,
      "INVALID_GROUP",
      "Choose a group from this board.",
    );
  if (changes.assigneeIds) ensurePeople(changes.assigneeIds, eligible);
}
function typedValue(
  field: { type: string; config: unknown },
  input: unknown,
  people: Set<string>,
) {
  const empty = {
    textValue: null as string | null,
    numberValue: null as number | null,
    booleanValue: null as boolean | null,
    dateValue: null as Date | null,
    choices: [] as string[],
    personIds: [] as string[],
  };
  if (input == null) return empty;
  switch (field.type) {
    case "TEXT":
    case "LONG_TEXT":
      empty.textValue = z
        .string()
        .max(field.type === "TEXT" ? 2000 : 10000)
        .parse(input);
      break;
    case "URL": {
      const value = z.string().max(2000).parse(input);
      if (value && !/^https?:\/\//i.test(z.string().url().parse(value)))
        throw new SetupError(422, "INVALID_URL", "Use an HTTP or HTTPS URL.");
      empty.textValue = value;
      break;
    }
    case "EMAIL":
      empty.textValue = z
        .union([z.literal(""), z.string().email().max(320)])
        .parse(input);
      break;
    case "NUMBER":
      empty.numberValue = z.number().finite().parse(input);
      break;
    case "CHECKBOX":
      empty.booleanValue = z.boolean().parse(input);
      break;
    case "DATE":
      empty.dateValue = new Date(`${dateOnly.parse(input)}T00:00:00Z`);
      break;
    case "STATUS":
    case "SINGLE_SELECT": {
      const value = z.string().parse(input);
      if (!fieldOptions(field.config).some((option) => option.id === value))
        throw new SetupError(
          422,
          "INVALID_OPTION",
          "Choose a saved field option.",
        );
      empty.textValue = value;
      break;
    }
    case "TAGS":
    case "MULTI_SELECT": {
      const values = z.array(z.string()).max(50).parse(input);
      if (
        new Set(values).size !== values.length ||
        values.some(
          (value) =>
            !fieldOptions(field.config).some((option) => option.id === value),
        )
      )
        throw new SetupError(
          422,
          "INVALID_OPTION",
          "Choose each saved field option once.",
        );
      empty.choices = values;
      break;
    }
    case "PEOPLE":
      empty.personIds = z.array(personId).max(50).parse(input);
      ensurePeople(empty.personIds, people);
      if (new Set(empty.personIds).size !== empty.personIds.length)
        throw new SetupError(422, "INVALID_PERSON", "Choose each person once.");
      break;
    default:
      throw new SetupError(
        422,
        "INVALID_FIELD",
        "This field type cannot be edited.",
      );
  }
  return empty;
}
export function validateValues(
  values: Record<string, unknown> | undefined,
  board: Awaited<ReturnType<typeof access>>["board"],
  people: Set<string>,
) {
  for (const [id, input] of Object.entries(values ?? {})) {
    const field = board.columns.find(
      (column) => column.id === id && !coreKeys.includes(column.key),
    );
    if (!field)
      throw new SetupError(
        422,
        "INVALID_FIELD",
        "Choose an active custom field from this board.",
      );
    typedValue(field, input, people);
  }
}
export async function saveValues(
  tx: DatabaseTransaction,
  taskId: string,
  values: Record<string, unknown> | undefined,
  board: Awaited<ReturnType<typeof access>>["board"],
  people: Set<string>,
) {
  for (const [fieldId, input] of Object.entries(values ?? {})) {
    const field = board.columns.find(
      (column) => column.id === fieldId && !coreKeys.includes(column.key),
    );
    if (!field)
      throw new SetupError(
        422,
        "INVALID_FIELD",
        "Choose an active custom field from this board.",
      );
    const { personIds, ...data } = typedValue(field, input, people);
    const value = await tx.taskFieldValue.upsert({
      where: { taskId_fieldId: { taskId, fieldId } },
      create: { taskId, fieldId, ...data },
      update: data,
    });
    await tx.taskFieldPerson.deleteMany({ where: { valueId: value.id } });
    if (personIds.length)
      await tx.taskFieldPerson.createMany({
        data: personIds.map((userId) => ({ valueId: value.id, userId })),
      });
  }
}
const taskInclude = {
  _count: {
    select: {
      comments: { where: { deletedAt: null } },
      attachments: { where: { removedAt: null } },
    },
  },
  createdBy: { select: { name: true } },
  assignees: true,
  editors: true,
  values: { include: { people: true, field: true } },
  activity: {
    select: {
      id: true,
      action: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
    orderBy: { revision: "desc" as const },
    take: 100,
  },
};
type LoadedTask = NonNullable<Awaited<ReturnType<typeof loadTask>>>;
export async function loadTask(tx: DatabaseTransaction, id: string) {
  return tx.task.findUnique({ where: { id }, include: taskInclude });
}
export function canEdit(
  task: LoadedTask,
  context: Awaited<ReturnType<typeof access>>,
) {
  return (
    context.canManage ||
    task.createdById === context.user.id ||
    task.assignees.some((person) => person.userId === context.user.id) ||
    task.editors.some((person) => person.userId === context.user.id)
  );
}
export function snapshot(task: LoadedTask) {
  return JSON.parse(
    JSON.stringify({
      name: task.name,
      description: task.description,
      checklist: checklistSchema.parse(task.checklist),
      statusId: task.statusId,
      priority: task.priority,
      dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
      groupId: task.groupId,
      assigneeIds: task.assignees.map((person) => person.userId),
      editorIds: task.editors.map((person) => person.userId),
      fieldValues: valueMap(task),
      archivedAt: task.archivedAt?.toISOString() ?? null,
    }),
  );
}
function valueMap(task: LoadedTask): Record<string, FieldValue> {
  return Object.fromEntries(
    task.values
      .filter((value) => !value.field.archivedAt)
      .map((value) => [
        value.fieldId,
        value.field.type === "PEOPLE"
          ? value.people.map((person) => person.userId)
          : ["MULTI_SELECT", "TAGS"].includes(value.field.type)
            ? value.choices
            : (value.textValue ??
              value.numberValue ??
              value.booleanValue ??
              value.dateValue?.toISOString().slice(0, 10) ??
              null),
      ]),
  );
}
export async function boardState(
  boardId: string,
  headers: Headers,
): Promise<BoardState> {
  const { user, settings } = await requireIdentity(headers);
  return db().$transaction(async (tx) => {
    const context = await access(tx, user.id, boardId);
    const tasks = await tx.task.findMany({
      where: { boardId },
      include: taskInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const policy = await readApprovalPolicy(tx, context.board);
    const commentEvents = await tx.boardEvent.findMany({
      where: {
        boardId,
        action: {
          in: [
            "Added task comment",
            "Edited task comment",
            "Removed task comment",
            "Uploaded task attachment",
            "Removed task attachment",
          ],
        },
      },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const visiblePending = await tx.boardProposal.findMany({
      where: {
        boardId,
        status: "PENDING",
        ...(context.canManage ||
        [policy.primaryApproverId, policy.backupApproverId].includes(user.id)
          ? {}
          : { authorId: user.id }),
      },
      select: {
        id: true,
        taskId: true,
        operation: true,
        authorId: true,
        author: { select: { name: true } },
        task: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const savedViews = await tx.savedBoardView.findMany({
      where: { boardId, OR: [{ ownerId: user.id }, { visibility: "SHARED" }] },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const selection = await tx.boardViewSelection.findUnique({
      where: { boardId_userId: { boardId, userId: user.id } },
    });
    return {
      calendarDate: new Intl.DateTimeFormat("en-CA", {
        timeZone: settings.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      savedViews: savedViews.map((view) => savedViewSchema.parse(view)),
      selectedViewId: savedViews.some((view) => view.id === selection?.viewId)
        ? selection!.viewId
        : null,
      boardId,
      approvalPolicy: policy,
      pendingApprovals: visiblePending.map((proposal) => ({
        id: proposal.id,
        taskId: proposal.taskId,
        operation: proposal.operation,
        authorId: proposal.authorId,
        authorName: proposal.author.name,
        name: proposal.task?.name ?? "New task request",
        createdAt: proposal.createdAt.toISOString(),
      })),
      canManage: context.canManage,
      canManageManagers: isAdministrator(context.user.role),
      managerIds: context.board.managers.map((manager) => manager.userId),
      currentUserId: user.id,
      groups: context.board.groups.map(({ id, name }) => ({ id, name })),
      fields: context.board.columns.map((field) => ({
        id: field.id,
        version: digest(
          JSON.stringify({
            name: field.name,
            type: field.type,
            config: field.config,
          }),
        ),
        key: field.key,
        name: field.name,
        type: field.type,
        options: fieldOptions(field.config),
      })),
      people: await eligiblePeople(tx, context.board.workspaceId),
      tasks: tasks.map((task) => ({
        id: task.id,
        ...snapshot(task),
        createdById: task.createdById,
        createdByName: task.createdBy.name,
        revision: task.revision,
        canEdit: !task.archivedAt && canEdit(task, context),
        commentCount: task._count.comments,
        attachmentCount: task._count.attachments,
        activity: [
          ...task.activity,
          ...commentEvents.filter(
            (event) =>
              (event.after as { taskId?: string } | null)?.taskId === task.id,
          ),
        ]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 20)
          .map((event) => ({
            id: event.id,
            action:
              event.action +
              (event.action === "Uploaded task attachment" ||
              event.action === "Removed task attachment"
                ? `: ${(event as { after?: { fileName?: string } }).after?.fileName ?? "File"}`
                : ""),
            actor: event.actor.name,
            createdAt: event.createdAt.toISOString(),
          })),
      })),
    };
  });
}
export async function createTaskRecord(
  tx: DatabaseTransaction,
  context: Awaited<ReturnType<typeof access>>,
  people: Set<string>,
  body: z.infer<typeof createTaskSchema>,
  authorId: string,
  inputDigest: string,
  actorId = authorId,
  activityAction = "Created task",
) {
  validateCore(body, context.board, people);
  validateValues(body.fieldValues, context.board, people);
  const task = await tx.task.create({
    data: {
      boardId: context.board.id,
      name: body.name,
      description: body.description ?? "",
      checklist: body.checklist ?? [],
      statusId: body.statusId,
      priority: body.priority ?? "NORMAL",
      dueDate: body.dueDate ? new Date(`${body.dueDate}T00:00:00Z`) : null,
      groupId: body.groupId,
      createdById: authorId,
      createKey: body.createKey,
      createDigest: inputDigest,
      assignees: {
        create: (body.assigneeIds ?? []).map((userId) => ({ userId })),
      },
    },
  });
  await saveValues(tx, task.id, body.fieldValues, context.board, people);
  await createNotifications(tx, {
    recipientIds: body.assigneeIds ?? [],
    actorId,
    boardId: task.boardId,
    taskId: task.id,
    kind: "ASSIGNMENT",
    message: "assigned you to this task",
    eventKey: `task:${task.id}:assignment:1`,
  });
  await tx.taskActivity.create({
    data: {
      taskId: task.id,
      actorId,
      action: activityAction,
      revision: 1,
      after: snapshot((await loadTask(tx, task.id))!),
    },
  });
  return {
    outcome: "APPLIED" as const,
    taskId: task.id,
    revision: task.revision,
  };
}
export async function applyTaskRecord(
  tx: DatabaseTransaction,
  task: LoadedTask,
  context: Awaited<ReturnType<typeof access>>,
  people: Set<string>,
  actorId: string,
  action: string,
  changes?: z.infer<typeof updateTaskSchema>["changes"],
  grant?: { userId: string; grant: boolean },
  activityAction?: string,
) {
  const before = snapshot(task);
  if (changes) {
    validateCore(changes, context.board, people);
    validateValues(changes.fieldValues, context.board, people);
  }
  const { assigneeIds, fieldValues, dueDate, ...scalar } = changes ?? {};
  const updated = await tx.task.updateMany({
    where: { id: task.id, revision: task.revision },
    data: {
      ...scalar,
      ...(dueDate !== undefined
        ? { dueDate: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null }
        : {}),
      ...(action === "archive"
        ? { archivedAt: new Date() }
        : action === "restore"
          ? { archivedAt: null }
          : {}),
      revision: { increment: 1 },
    },
  });
  if (!updated.count) throw conflict();
  if (assigneeIds) {
    await tx.taskAssignee.deleteMany({ where: { taskId: task.id } });
    if (assigneeIds.length)
      await tx.taskAssignee.createMany({
        data: assigneeIds.map((userId) => ({ taskId: task.id, userId })),
      });
  }
  if (grant) {
    if (grant.grant) ensurePeople([grant.userId], people);
    if (grant.grant)
      await tx.taskEditorGrant.upsert({
        where: { taskId_userId: { taskId: task.id, userId: grant.userId } },
        create: {
          taskId: task.id,
          userId: grant.userId,
          grantedById: actorId,
        },
        update: {},
      });
    else
      await tx.taskEditorGrant.deleteMany({
        where: { taskId: task.id, userId: grant.userId },
      });
  }
  await saveValues(tx, task.id, fieldValues, context.board, people);
  const after = await loadTask(tx, task.id);
  if (assigneeIds)
    await createNotifications(tx, {
      recipientIds: assigneeIds.filter(
        (id) => !task.assignees.some((person) => person.userId === id),
      ),
      actorId,
      boardId: task.boardId,
      taskId: task.id,
      kind: "ASSIGNMENT",
      message: "assigned you to this task",
      eventKey: `task:${task.id}:assignment:${after!.revision}`,
    });
  await tx.taskActivity.create({
    data: {
      taskId: task.id,
      actorId,
      action:
        activityAction ??
        (action === "archive"
          ? "Archived task"
          : action === "restore"
            ? "Restored task"
            : action === "editor"
              ? "Changed task editors"
              : "Updated task"),
      revision: after!.revision,
      before,
      after: snapshot(after!),
    },
  });
  return {
    outcome: "APPLIED" as const,
    taskId: task.id,
    revision: after!.revision,
  };
}
export async function createTask(
  input: unknown,
  headers: Headers,
): Promise<TaskMutationResult> {
  const body = createTaskSchema.parse(input);
  const { user } = await requireIdentity(headers);
  return serial(async (tx) => {
    const context = await access(tx, user.id, body.boardId, true);
    const inputDigest = digest(
      JSON.stringify({
        ...body,
        fieldValues: Object.entries(body.fieldValues ?? {}).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      }),
    );
    const existing = await tx.task.findUnique({
      where: {
        createdById_createKey: {
          createdById: user.id,
          createKey: body.createKey,
        },
      },
    });
    if (existing) {
      if (
        existing.boardId !== body.boardId ||
        existing.createDigest !== inputDigest
      )
        throw new SetupError(
          409,
          "RETRY_CHANGED",
          "This creation key already belongs to a different task request.",
        );
      return {
        outcome: "APPLIED",
        taskId: existing.id,
        revision: existing.revision,
      };
    }
    const cached = await existingProposal(
      tx,
      user.id,
      body.createKey,
      inputDigest,
    );
    if (cached) return cached;
    const people = new Set(
      (await eligiblePeople(tx, context.board.workspaceId)).map(
        (person) => person.id,
      ),
    );
    const initial = {
      ...body,
      description: body.description ?? "",
      checklist: body.checklist ?? [],
      priority: body.priority ?? "NORMAL",
      dueDate: body.dueDate ?? null,
      assigneeIds: body.assigneeIds ?? [],
      fieldValues: body.fieldValues ?? {},
      statusId:
        body.statusId === undefined
          ? (options(context.board)[0]?.id ?? null)
          : body.statusId,
      groupId:
        body.groupId === undefined
          ? (context.board.groups[0]?.id ?? null)
          : body.groupId,
    };
    validateCore(initial, context.board, people);
    validateValues(initial.fieldValues, context.board, people);
    const policy = await readApprovalPolicy(tx, context.board);
    if (needsApproval(policy, "CREATE", initial, context.board.columns))
      return submitProposal(tx, {
        boardId: body.boardId,
        authorId: user.id,
        operation: "CREATE",
        requestKey: body.createKey,
        requestDigest: inputDigest,
        changes: initial,
        baseline: {},
        policy,
        eligible: people,
      });
    return createTaskRecord(tx, context, people, initial, user.id, inputDigest);
  });
}
export async function mutateTask(
  action: string,
  input: unknown,
  headers: Headers,
): Promise<TaskMutationResult> {
  const patch = action === "update" ? updateTaskSchema.parse(input) : undefined;
  const grant =
    action === "editor" ? editorGrantSchema.parse(input) : undefined;
  const body = patch ?? grant ?? taskActionSchema.parse(input);
  const { user } = await requireIdentity(headers);
  return serial(async (tx) => {
    const task = await loadTask(tx, body.taskId);
    if (!task) throw notFound();
    const context = await access(tx, user.id, task.boardId, true);
    if (
      action === "restore" || action === "editor"
        ? !context.canManage
        : !canEdit(task, context)
    )
      throw new SetupError(
        403,
        "FORBIDDEN",
        "You do not have permission to change this task.",
      );
    const requestDigest = digest(stableJson({ action, ...body }));
    const requestKey = body.requestKey ?? requestDigest;
    if (["update", "archive"].includes(action)) {
      const cached = await existingProposal(
        tx,
        user.id,
        requestKey,
        requestDigest,
      );
      if (cached) return cached;
    }
    if (task.archivedAt && action !== "restore")
      throw new SetupError(
        409,
        "TASK_ARCHIVED",
        "Archived tasks are read-only. Ask a board manager to restore it first.",
      );
    if (task.revision !== body.revision) throw conflict();
    const people = new Set(
      (await eligiblePeople(tx, context.board.workspaceId)).map(
        (person) => person.id,
      ),
    );
    const changes = patch?.changes;
    if (changes) {
      validateCore(changes, context.board, people);
      validateValues(changes.fieldValues, context.board, people);
    }
    const policy = await readApprovalPolicy(tx, context.board);
    const operation = action === "archive" ? "ARCHIVE" : "UPDATE";
    const proposedChanges = actualApprovalChanges(
      snapshot(task),
      changes ?? {},
    );
    if (
      ["update", "archive"].includes(action) &&
      needsApproval(policy, operation, proposedChanges, context.board.columns)
    )
      return submitProposal(tx, {
        boardId: task.boardId,
        taskId: task.id,
        authorId: user.id,
        operation,
        requestKey,
        requestDigest,
        changes: proposedChanges,
        baseline: snapshot(task),
        policy,
        eligible: people,
        sourceRevision: task.revision,
      });
    return applyTaskRecord(
      tx,
      task,
      context,
      people,
      user.id,
      action,
      changes,
      grant,
    );
  });
}
export async function manageBoard(
  action: string,
  input: unknown,
  headers: Headers,
) {
  const { user } = await requireIdentity(headers);
  if (action === "create-board") {
    const body = boardCreateSchema.parse(input);
    return serial(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: user.id } });
      const workspace =
        current &&
        (await tx.workspace.findFirst({
          where: { id: body.workspaceId, ...workspaceScope(current) },
        }));
      if (!current || !workspace) throw notFound();
      if (
        !isAdministrator(current.role) &&
        !(await tx.board.count({
          where: {
            managers: { some: { userId: user.id } },
            workspace: workspaceScope(current),
          },
        }))
      )
        throw new SetupError(
          403,
          "FORBIDDEN",
          "A board manager or administrator must create boards.",
        );
      if (
        (
          await tx.installationSettings.findUnique({
            where: { id: "installation" },
          })
        )?.maintenanceMode
      )
        throw new SetupError(
          503,
          "MAINTENANCE",
          "Changes are paused during maintenance.",
        );
      const columns = [
        { key: "name", name: "Task", type: "TEXT", position: 0 },
        {
          key: "status",
          name: "Status",
          type: "STATUS",
          position: 1,
          config: {
            options: [
              { id: "todo", label: "To do" },
              { id: "in_progress", label: "In progress" },
              { id: "done", label: "Done" },
            ],
          },
        },
        { key: "assignees", name: "Assignees", type: "PEOPLE", position: 2 },
        { key: "priority", name: "Priority", type: "PRIORITY", position: 3 },
        { key: "due_date", name: "Due date", type: "DATE", position: 4 },
        {
          key: "description",
          name: "Description",
          type: "LONG_TEXT",
          position: 5,
        },
      ];
      return tx.board.create({
        data: {
          workspaceId: workspace.id,
          name: body.name,
          createdById: user.id,
          managers: { create: { userId: user.id, grantedById: user.id } },
          columns: { create: columns },
          groups: { create: { name: "Tasks", position: 0 } },
        },
        select: { id: true },
      });
    });
  }
  if (action === "manager") {
    const body = boardManagerSchema.parse(input);
    return serial(async (tx) => {
      const context = await access(tx, user.id, body.boardId, true);
      if (!isAdministrator(context.user.role))
        throw new SetupError(
          403,
          "FORBIDDEN",
          "Only owners and administrators can appoint board managers.",
        );
      if (body.grant) {
        ensurePeople(
          [body.userId],
          new Set(
            (await eligiblePeople(tx, context.board.workspaceId)).map(
              (person) => person.id,
            ),
          ),
        );
        await tx.boardManager.upsert({
          where: {
            boardId_userId: { boardId: body.boardId, userId: body.userId },
          },
          create: {
            boardId: body.boardId,
            userId: body.userId,
            grantedById: user.id,
          },
          update: {},
        });
      } else
        await tx.boardManager.deleteMany({
          where: { boardId: body.boardId, userId: body.userId },
        });
      await tx.boardEvent.create({
        data: {
          boardId: body.boardId,
          actorId: user.id,
          subjectId: body.userId,
          action: body.grant
            ? "Granted board manager"
            : "Removed board manager",
        },
      });
      return { boardId: body.boardId };
    });
  }
  if (action === "remove-field") {
    const body = removeFieldSchema.parse(input);
    return serial(async (tx) => {
      const context = await access(tx, user.id, body.boardId, true);
      if (!context.canManage)
        throw new SetupError(
          403,
          "FORBIDDEN",
          "A board manager must remove fields.",
        );
      const field = context.board.columns.find(
        (item) => item.id === body.fieldId,
      );
      if (!field) throw notFound();
      if (coreKeys.includes(field.key))
        throw new SetupError(
          422,
          "CORE_FIELD",
          "Core task fields cannot be removed.",
        );
      if (
        body.version !==
        digest(
          JSON.stringify({
            name: field.name,
            type: field.type,
            config: field.config,
          }),
        )
      )
        throw new SetupError(
          409,
          "FIELD_CHANGED",
          "This field changed. Reload its current configuration first.",
        );
      await tx.boardColumn.update({
        where: { id: field.id },
        data: { archivedAt: new Date() },
      });
      await tx.boardEvent.create({
        data: {
          boardId: body.boardId,
          actorId: user.id,
          subjectId: field.id,
          action: "Removed custom field",
        },
      });
      return { id: field.id };
    });
  }
  if (action === "configure-field") {
    const body = configureFieldSchema.parse(input);
    return serial(async (tx) => {
      const context = await access(tx, user.id, body.boardId, true);
      if (!context.canManage)
        throw new SetupError(
          403,
          "FORBIDDEN",
          "A board manager must configure fields.",
        );
      const field = context.board.columns.find(
        (field) => field.id === body.fieldId,
      );
      if (!field) throw notFound();
      if (
        body.version !==
        digest(
          JSON.stringify({
            name: field.name,
            type: field.type,
            config: field.config,
          }),
        )
      )
        throw new SetupError(
          409,
          "FIELD_CHANGED",
          "This field changed. Reload its current configuration first.",
        );
      const selected = [
        "STATUS",
        "SINGLE_SELECT",
        "MULTI_SELECT",
        "TAGS",
        "PRIORITY",
      ].includes(field.type);
      if (
        field.key === "priority" &&
        (body.options.length !== priorities.length ||
          priorities.some(
            (id) => !body.options.some((option) => option.id === id),
          ))
      )
        throw new SetupError(
          422,
          "INVALID_PRIORITY",
          "Keep all four saved priority options.",
        );
      if (field.key === "status" && !body.options.length)
        throw new SetupError(
          422,
          "INVALID_OPTIONS",
          "Keep at least one status option.",
        );
      if (
        selected &&
        (new Set(body.options.map((option) => option.id)).size !==
          body.options.length ||
          new Set(body.options.map((option) => option.label)).size !==
            body.options.length)
      )
        throw new SetupError(
          422,
          "INVALID_OPTIONS",
          "Use unique option IDs and labels.",
        );
      if (selected) {
        const removed = fieldOptions(field.config)
          .filter(
            (option) => !body.options.some((next) => next.id === option.id),
          )
          .map((option) => option.id);
        const coreUse =
          field.key === "status" && removed.length
            ? await tx.task.count({
                where: { boardId: body.boardId, statusId: { in: removed } },
              })
            : 0;
        const customUse = removed.length
          ? await tx.taskFieldValue.count({
              where: {
                fieldId: field.id,
                OR: [
                  { textValue: { in: removed } },
                  { choices: { hasSome: removed } },
                ],
              },
            })
          : 0;
        if (coreUse || customUse)
          throw new SetupError(
            409,
            "OPTION_IN_USE",
            "An option is used by a task. Move those tasks before removing it.",
          );
      }
      return tx.boardColumn.update({
        where: { id: field.id },
        data: {
          name: body.name,
          ...(selected ? { config: { options: body.options } } : {}),
        },
        select: { id: true },
      });
    });
  }
  if (action === "remove-group") {
    const body = removeGroupSchema.parse(input);
    try {
      return await serial(async (tx) => {
        const context = await access(tx, user.id, body.boardId, true);
        if (!context.canManage)
          throw new SetupError(
            403,
            "FORBIDDEN",
            "Only a board manager or administrator can remove groups.",
          );
        const group = context.board.groups.find(
          (group) => group.id === body.groupId,
        );
        if (!group) throw notFound();
        if (group.name !== body.expectedName)
          throw new SetupError(
            409,
            "GROUP_CHANGED",
            "This group changed. Reopen board details before removing it.",
          );
        const tasks = await tx.task.count({ where: { groupId: group.id } });
        const requests = await tx.boardProposal.count({
          where: {
            boardId: body.boardId,
            status: "PENDING",
            changes: { path: ["groupId"], equals: group.id },
          },
        });
        if (tasks || requests)
          throw new SetupError(
            409,
            "GROUP_IN_USE",
            "This group is used by tasks (including archived tasks) or pending approval requests. Move them to another group before removing it.",
          );
        await tx.boardGroup.delete({ where: { id: group.id } });
        await tx.boardEvent.create({
          data: {
            boardId: body.boardId,
            actorId: user.id,
            subjectId: group.id,
            action: "Removed task group",
            before: { name: group.name },
          },
        });
        return { boardId: body.boardId };
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2003"
      )
        throw new SetupError(
          409,
          "GROUP_IN_USE",
          "This group is now in use. Move its tasks before removing it.",
        );
      throw error;
    }
  }
  if (action === "rename-group") {
    const body = renameGroupSchema.parse(input);
    return serial(async (tx) => {
      const context = await access(tx, user.id, body.boardId, true);
      if (!context.canManage)
        throw new SetupError(
          403,
          "FORBIDDEN",
          "A board manager must rename groups.",
        );
      const group = context.board.groups.find(
        (group) => group.id === body.groupId,
      );
      if (!group) throw notFound();
      if (group.name !== body.expectedName)
        throw new SetupError(
          409,
          "GROUP_CHANGED",
          "This group changed. Reload it before renaming.",
        );
      return tx.boardGroup.update({
        where: { id: group.id },
        data: { name: body.name },
        select: { id: true },
      });
    });
  }
  const field = action === "field" ? fieldSchema.parse(input) : undefined;
  const body = field ?? groupSchema.parse(input);
  return serial(async (tx) => {
    const context = await access(tx, user.id, body.boardId, true);
    if (!context.canManage)
      throw new SetupError(
        403,
        "FORBIDDEN",
        "Only board managers and administrators can change board structure.",
      );
    if (action === "group")
      return tx.boardGroup.create({
        data: {
          boardId: body.boardId,
          name: body.name,
          position:
            context.board.groups.reduce(
              (highest, group) => Math.max(highest, group.position),
              -1,
            ) + 1,
        },
        select: { id: true },
      });
    if (!field)
      throw new SetupError(422, "INVALID_INPUT", "Choose a field type.");
    if (
      ["STATUS", "SINGLE_SELECT", "MULTI_SELECT", "TAGS"].includes(
        field.type,
      ) &&
      (!field.options.length ||
        new Set(field.options).size !== field.options.length)
    )
      throw new SetupError(
        422,
        "INVALID_OPTIONS",
        "Choose unique field options.",
      );
    return tx.boardColumn.create({
      data: {
        boardId: body.boardId,
        name: body.name,
        type: field.type,
        key: `custom_${createRecordId()}`,
        position:
          context.board.columns.reduce(
            (highest, column) => Math.max(highest, column.position),
            -1,
          ) + 1,
        config: {
          options: field.options.map((label) => ({
            id: createRecordId(),
            label,
          })),
        },
      },
      select: { id: true },
    });
  });
}

export async function taskComments(taskId: string, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return db().$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: { boardId: true, archivedAt: true },
    });
    if (!task) throw notFound();
    const context = await access(tx, user.id, task.boardId);
    const comments = await tx.taskComment.findMany({
      where: { taskId },
      include: { author: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return comments.reverse().map((comment) => ({
      id: comment.id,
      authorId: comment.authorId,
      authorName: comment.author.name,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      revision: comment.revision,
      mentions: comment.deletedAt ? [] : comment.mentions,
      deletedAt: comment.deletedAt?.toISOString() ?? null,
      canEdit:
        !task.archivedAt && !comment.deletedAt && comment.authorId === user.id,
      canRemove:
        !task.archivedAt &&
        !comment.deletedAt &&
        (comment.authorId === user.id || context.canManage),
    }));
  });
}
export async function createComment(input: unknown, headers: Headers) {
  const body = commentCreateSchema.parse(input);
  const { user } = await requireIdentity(headers);
  return serial(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: body.taskId },
      select: { boardId: true, archivedAt: true },
    });
    if (!task) throw notFound();
    const context = await access(tx, user.id, task.boardId, true);
    if (task.archivedAt)
      throw new SetupError(
        409,
        "TASK_ARCHIVED",
        "Archived tasks are read-only.",
      );
    const existing = await tx.taskComment.findUnique({
      where: {
        taskId_authorId_createKey: {
          taskId: body.taskId,
          authorId: user.id,
          createKey: body.createKey,
        },
      },
    });
    if (existing) {
      if (
        (existing.createDigest ??
          digest(stableJson({ body: existing.body, mentionIds: [] }))) !==
        digest(
          stableJson({
            body: body.body,
            mentionIds: [...body.mentionIds].sort(),
          }),
        )
      )
        throw new SetupError(
          409,
          "COMMENT_CHANGED",
          "This comment request was already used. Try a new comment.",
        );
      return { id: existing.id };
    }
    const mentions = await validateCommentMentions(
      tx,
      context.board.workspaceId,
      body.body,
      body.mentionIds,
    );
    const { mentionIds, ...data } = body;
    const comment = await tx.taskComment.create({
      data: {
        ...data,
        authorId: user.id,
        mentions,
        createDigest: digest(
          stableJson({ body: body.body, mentionIds: [...mentionIds].sort() }),
        ),
        revisions: {
          create: {
            actorId: user.id,
            revision: 1,
            action: "Created comment",
            body: body.body,
            mentions,
          },
        },
      },
    });
    await createNotifications(tx, {
      recipientIds: mentionIds,
      actorId: user.id,
      boardId: task.boardId,
      taskId: body.taskId,
      kind: "MENTION",
      message: "mentioned you in a comment",
      eventKey: `comment:${comment.id}:mentions:1`,
    });
    await tx.boardEvent.create({
      data: {
        boardId: task.boardId,
        actorId: user.id,
        subjectId: comment.id,
        action: "Added task comment",
        after: { taskId: body.taskId, revision: 1 },
      },
    });
    return { id: comment.id };
  });
}

async function validateCommentMentions(
  tx: DatabaseTransaction,
  workspaceId: string,
  body: string,
  mentionIds: string[],
) {
  const people = await eligiblePeople(tx, workspaceId);
  return mentionIds.map((id) => {
    const person = people.find((person) => person.id === id);
    if (!person || !mentionPresent(body, person.name))
      throw new SetupError(
        422,
        "INVALID_MENTION",
        "Choose a teammate with current board access and keep their @name in the comment.",
      );
    return { id, name: person.name };
  });
}
export async function changeComment(input: unknown, headers: Headers) {
  const body = commentChangeSchema.parse(input);
  const { user } = await requireIdentity(headers);
  return serial(async (tx) => {
    const comment = await tx.taskComment.findUnique({
      where: { id: body.commentId },
      include: { task: { select: { boardId: true, archivedAt: true } } },
    });
    if (!comment) throw notFound();
    const context = await access(tx, user.id, comment.task.boardId, true);
    if (
      body.action === "edit"
        ? comment.authorId !== user.id
        : comment.authorId !== user.id && !context.canManage
    )
      throw new SetupError(
        403,
        "FORBIDDEN",
        "Only the author may edit a comment. The author or a board manager may remove it.",
      );
    if (comment.task.archivedAt)
      throw new SetupError(
        409,
        "TASK_ARCHIVED",
        "Archived tasks are read-only.",
      );
    if (comment.deletedAt || comment.revision !== body.revision)
      throw new SetupError(
        409,
        "COMMENT_CHANGED",
        "This comment changed. Load the latest comment before saving again.",
      );
    const mentions =
      body.action === "edit"
        ? await validateCommentMentions(
            tx,
            context.board.workspaceId,
            body.body,
            body.mentionIds,
          )
        : [];
    if (
      body.action === "edit" &&
      body.body === comment.body &&
      stableJson(mentions) === stableJson(comment.mentions)
    )
      return { taskId: comment.taskId, id: comment.id };
    // Older comments gain their original snapshot lazily without rewriting history.
    await tx.commentRevision.upsert({
      where: { commentId_revision: { commentId: comment.id, revision: 1 } },
      create: {
        commentId: comment.id,
        revision: 1,
        actorId: comment.authorId,
        action: "Created comment",
        body: comment.body,
        mentions: comment.mentions!,
        createdAt: comment.createdAt,
      },
      update: {},
    });
    const revision = comment.revision + 1;
    const nextBody = body.action === "edit" ? body.body : "";
    await tx.taskComment.update({
      where: { id: comment.id },
      data: {
        body: nextBody,
        mentions,
        revision,
        deletedAt: body.action === "remove" ? new Date() : null,
        createDigest:
          comment.createDigest ??
          digest(stableJson({ body: comment.body, mentionIds: [] })),
      },
    });
    await tx.commentRevision.create({
      data: {
        commentId: comment.id,
        revision,
        actorId: user.id,
        action: body.action === "edit" ? "Edited comment" : "Removed comment",
        body: nextBody,
        mentions,
      },
    });
    if (body.action === "edit") {
      const previous = z
        .array(z.object({ id: z.string() }))
        .parse(comment.mentions);
      await tx.notification.deleteMany({
        where: {
          kind: "MENTION",
          eventKey: { startsWith: `comment:${comment.id}:mentions:` },
          recipientId: { notIn: body.mentionIds },
        },
      });
      await createNotifications(tx, {
        recipientIds: body.mentionIds.filter(
          (id) => !previous.some((person) => person.id === id),
        ),
        actorId: user.id,
        boardId: comment.task.boardId,
        taskId: comment.taskId,
        kind: "MENTION",
        message: "mentioned you in a comment",
        eventKey: `comment:${comment.id}:mentions:${revision}`,
      });
    } else {
      await tx.notification.deleteMany({
        where: {
          kind: "MENTION",
          eventKey: { startsWith: `comment:${comment.id}:mentions:` },
        },
      });
    }
    await tx.boardEvent.create({
      data: {
        boardId: comment.task.boardId,
        actorId: user.id,
        subjectId: comment.id,
        action:
          body.action === "edit"
            ? "Edited task comment"
            : "Removed task comment",
        after: { taskId: comment.taskId, revision },
      },
    });
    return {
      taskId: comment.taskId,
      id: comment.id,
      affectedUserIds: z
        .array(z.object({ id: z.string() }))
        .parse(comment.mentions)
        .map((person) => person.id),
    };
  });
}
export async function commentHistory(commentId: string, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return db().$transaction(async (tx) => {
    const comment = await tx.taskComment.findUnique({
      where: { id: commentId },
      include: { task: { select: { boardId: true } } },
    });
    if (!comment) throw notFound();
    await access(tx, user.id, comment.task.boardId);
    if (comment.deletedAt) return []; // Removal hides the content, including old versions.
    const rows = await tx.commentRevision.findMany({
      where: { commentId },
      include: { actor: { select: { name: true } } },
      orderBy: { revision: "desc" },
      take: 50,
    });
    return rows.map((row) => ({
      revision: row.revision,
      action: row.action,
      body: row.body,
      actorName: row.actor.name,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}
