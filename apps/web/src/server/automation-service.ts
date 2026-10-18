import {
  createRecordId,
  getDatabase,
  type DatabaseTransaction,
} from "@yuzu/database";
import {
  AUTOMATION_MAX_DEPTH,
  AUTOMATION_RULE_LIMIT,
  automationActionSchema,
  automationConditionSchema,
  automationRemoveSchema,
  automationRuleInputSchema,
  automationToggleSchema,
  automationTriggerSchema,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRule,
  type AutomationRun,
  type AutomationTrigger,
} from "@/lib/automation-contract";
import {
  conditionsMatch,
  planActions,
  triggerMatches,
  type PlannedChanges,
  type RuleEvent,
  type RuleTask,
} from "@/lib/automation-engine";
import { coreKeys, fieldOptions, priorities } from "@/lib/board-contract";
import {
  actualApprovalChanges,
  needsApproval,
  stableJson,
} from "@/lib/approval-rules";
import { z } from "zod";
import {
  access,
  applyTaskRecord,
  eligiblePeople,
  loadTask,
  serial,
  snapshot,
  validateCore,
  validateValues,
} from "./board-service";
import { readApprovalPolicy, submitProposal } from "./approval-policy";
import { createNotifications } from "./notification-events";
import { notifyBoardMutation } from "./realtime";
import { requireIdentity } from "./team-access";
import { digest, SetupError } from "./setup/security";

const db = () => getDatabase();
const RETENTION_DAYS = 30;
const PAUSE_AFTER_FAILURES = 5;
type Board = Awaited<ReturnType<typeof access>>["board"];

const forbidden = () =>
  new SetupError(
    403,
    "FORBIDDEN",
    "Only board managers can change this board's automations.",
  );
const changed = () =>
  new SetupError(
    409,
    "RULE_CHANGED",
    "This rule changed since you opened it. Reload it before saving.",
  );

async function managerContext(
  tx: DatabaseTransaction,
  userId: string,
  boardId: string,
  write = false,
) {
  const context = await access(tx, userId, boardId, write);
  if (!context.canManage) throw forbidden();
  return context;
}

// ---------- Validation of rule references against the board ----------

function statusIds(board: Board) {
  return fieldOptions(
    board.columns.find((field) => field.key === "status")?.config,
  ).map((option) => option.id);
}
function customField(board: Board, id: string, types: string[]) {
  const field = board.columns.find(
    (column) => column.id === id && !coreKeys.includes(column.key),
  );
  if (!field || !types.includes(field.type))
    throw new SetupError(
      422,
      "INVALID_RULE",
      "A rule refers to a field that isn't on this board or can't be used here.",
    );
  return field;
}
function ensureOption(field: { config: unknown }, value: string) {
  if (!fieldOptions(field.config).some((option) => option.id === value))
    throw new SetupError(
      422,
      "INVALID_RULE",
      "A rule refers to an option that no longer exists.",
    );
}
function ensure(ok: boolean, message: string) {
  if (!ok) throw new SetupError(422, "INVALID_RULE", message);
}

function validateRule(
  board: Board,
  people: Set<string>,
  rule: {
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  },
) {
  const statuses = statusIds(board);
  const groups = board.groups.map((group) => group.id);
  const status = (id: string | null) =>
    ensure(id === null || statuses.includes(id), "Choose a saved status.");
  const priority = (id: string) =>
    ensure(
      (priorities as readonly string[]).includes(id),
      "Choose a priority.",
    );
  const group = (id: string | null) =>
    ensure(id === null || groups.includes(id), "Choose a group on this board.");
  const person = (id: string) =>
    ensure(people.has(id), "Choose people who can see this board.");

  const { trigger } = rule;
  if (trigger.kind === "status.changed") {
    status(trigger.from);
    status(trigger.to);
  } else if (trigger.kind === "assignee.added" && trigger.userId)
    person(trigger.userId);
  else if (trigger.kind === "field.changed") {
    if (trigger.field === "priority") priority(trigger.value);
    else if (trigger.field === "group") group(trigger.value);
    else
      ensureOption(
        customField(board, trigger.field, ["SINGLE_SELECT", "TAGS"]),
        trigger.value,
      );
  }
  for (const condition of rule.conditions) {
    if (condition.subject === "status") status(condition.value);
    else if (condition.subject === "priority") priority(condition.value ?? "");
    else if (condition.subject === "group") group(condition.value);
    else if (condition.subject === "assignees" && condition.userId)
      person(condition.userId);
    else if (condition.subject === "field") {
      const field = customField(board, condition.fieldId, [
        "SINGLE_SELECT",
        "TAGS",
        "CHECKBOX",
      ]);
      if (field.type === "CHECKBOX")
        ensure(typeof condition.value === "boolean", "Choose checked or not.");
      else ensureOption(field, String(condition.value));
    }
  }
  for (const action of rule.actions) {
    if (action.kind === "set.status") status(action.value);
    else if (action.kind === "set.priority") priority(action.value);
    else if (action.kind === "set.group") group(action.value);
    else if (action.kind === "assign" || action.kind === "unassign")
      person(action.userId);
    else if (action.kind === "notify") (action.userIds ?? []).forEach(person);
    else if (action.kind === "set.date") {
      if (action.field !== "dueDate" && action.field !== "startDate")
        customField(board, action.field, ["DATE"]);
    } else if (action.kind === "set.field") {
      const field = customField(board, action.fieldId, [
        "SINGLE_SELECT",
        "TAGS",
        "CHECKBOX",
      ]);
      if (action.value === null) continue;
      if (field.type === "CHECKBOX")
        ensure(typeof action.value === "boolean", "Choose checked or not.");
      else if (field.type === "TAGS")
        ensure(Array.isArray(action.value), "Choose tags.");
      else ensure(typeof action.value === "string", "Choose an option.");
      for (const value of Array.isArray(action.value)
        ? action.value
        : typeof action.value === "string"
          ? [action.value]
          : [])
        ensureOption(field, value);
    }
  }
}

// ---------- API: rules and their history ----------

const since = () => new Date(Date.now() - RETENTION_DAYS * 86_400_000);

function presentRule(
  rule: Awaited<ReturnType<typeof readRules>>[number],
  stats: Map<string, { runs: number; failures: number; last: Date | null }>,
): AutomationRule {
  const stat = stats.get(rule.id);
  return {
    id: rule.id,
    boardId: rule.boardId,
    name: rule.name,
    enabled: rule.enabled,
    trigger: automationTriggerSchema.parse(rule.trigger),
    conditions: z.array(automationConditionSchema).parse(rule.conditions),
    actions: z.array(automationActionSchema).parse(rule.actions),
    createdById: rule.createdById,
    createdByName: rule.createdBy.name,
    revision: rule.revision,
    pausedReason: rule.pausedReason,
    lastRunAt: stat?.last?.toISOString() ?? null,
    runCount: stat?.runs ?? 0,
    failureCount: stat?.failures ?? 0,
  };
}
function readRules(tx: DatabaseTransaction, boardId: string) {
  return tx.automationRule.findMany({
    where: { boardId },
    include: { createdBy: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
}
async function ruleStats(tx: DatabaseTransaction, ruleIds: string[]) {
  const [all, failed] = await Promise.all([
    tx.automationRun.groupBy({
      by: ["ruleId"],
      where: { ruleId: { in: ruleIds }, createdAt: { gte: since() } },
      _count: true,
      _max: { createdAt: true },
    }),
    tx.automationRun.groupBy({
      by: ["ruleId"],
      where: {
        ruleId: { in: ruleIds },
        createdAt: { gte: since() },
        outcome: "FAILED",
      },
      _count: true,
    }),
  ]);
  return new Map(
    all.map((row) => [
      row.ruleId,
      {
        runs: row._count,
        last: row._max.createdAt,
        failures:
          failed.find((item) => item.ruleId === row.ruleId)?._count ?? 0,
      },
    ]),
  );
}

export async function listAutomations(boardId: string, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return serial(async (tx) => {
    await managerContext(tx, user.id, boardId);
    const rules = await readRules(tx, boardId);
    const stats = await ruleStats(
      tx,
      rules.map((rule) => rule.id),
    );
    return { rules: rules.map((rule) => presentRule(rule, stats)) };
  });
}

export async function automationRuns(
  ruleId: string,
  headers: Headers,
): Promise<{ runs: AutomationRun[] }> {
  const { user } = await requireIdentity(headers);
  return serial(async (tx) => {
    const rule = await tx.automationRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new SetupError(404, "NOT_FOUND", "This rule is gone.");
    await managerContext(tx, user.id, rule.boardId);
    const runs = await tx.automationRun.findMany({
      where: { ruleId, createdAt: { gte: since() } },
      include: {
        task: { select: { name: true } },
        event: { select: { kind: true, depth: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      runs: runs.map((run) => ({
        id: run.id,
        taskId: run.taskId,
        taskName: run.task.name,
        trigger: run.event.kind,
        outcome: run.outcome,
        detail: run.detail,
        depth: run.event.depth,
        createdAt: run.createdAt.toISOString(),
      })),
    };
  });
}

export async function mutateAutomation(
  action: string,
  input: unknown,
  headers: Headers,
) {
  const { user } = await requireIdentity(headers);
  if (action === "save-automation") {
    const body = automationRuleInputSchema.parse(input);
    return serial(async (tx) => {
      const context = await managerContext(tx, user.id, body.boardId, true);
      const people = new Set(
        (await eligiblePeople(tx, context.board)).map((person) => person.id),
      );
      validateRule(context.board, people, body);
      const data = {
        name: body.name,
        enabled: body.enabled,
        trigger: body.trigger,
        conditions: body.conditions,
        actions: body.actions,
        pausedReason: null,
        consecutiveFailures: 0,
      };
      if (body.id) {
        const updated = await tx.automationRule.updateMany({
          where: {
            id: body.id,
            boardId: body.boardId,
            revision: body.revision,
          },
          data: { ...data, revision: { increment: 1 } },
        });
        if (!updated.count) throw changed();
        return { id: body.id, boardId: body.boardId };
      }
      const count = await tx.automationRule.count({
        where: { boardId: body.boardId },
      });
      if (count >= AUTOMATION_RULE_LIMIT)
        throw new SetupError(
          409,
          "RULE_LIMIT",
          `A board can hold up to ${AUTOMATION_RULE_LIMIT} rules. Remove one first.`,
        );
      const id = createRecordId();
      await tx.automationRule.create({
        data: { id, boardId: body.boardId, createdById: user.id, ...data },
      });
      return { id, boardId: body.boardId };
    });
  }
  if (action === "toggle-automation") {
    const body = automationToggleSchema.parse(input);
    return serial(async (tx) => {
      const rule = await tx.automationRule.findUnique({
        where: { id: body.id },
      });
      if (!rule) throw changed();
      await managerContext(tx, user.id, rule.boardId, true);
      const updated = await tx.automationRule.updateMany({
        where: { id: body.id, revision: body.revision },
        data: {
          enabled: body.enabled,
          revision: { increment: 1 },
          ...(body.enabled
            ? { pausedReason: null, consecutiveFailures: 0 }
            : {}),
        },
      });
      if (!updated.count) throw changed();
      return { id: rule.id, boardId: rule.boardId };
    });
  }
  if (action === "remove-automation") {
    const body = automationRemoveSchema.parse(input);
    return serial(async (tx) => {
      const rule = await tx.automationRule.findUnique({
        where: { id: body.id },
      });
      if (!rule) throw changed();
      await managerContext(tx, user.id, rule.boardId, true);
      const removed = await tx.automationRule.deleteMany({
        where: { id: body.id, revision: body.revision },
      });
      if (!removed.count) throw changed();
      return { id: rule.id, boardId: rule.boardId };
    });
  }
  throw new SetupError(404, "NOT_FOUND", "Automation action not found.");
}

// ---------- Execution ----------

type StoredEvent = NonNullable<
  Awaited<ReturnType<ReturnType<typeof db>["automationEvent"]["findUnique"]>>
>;
type StoredRule = NonNullable<
  Awaited<ReturnType<ReturnType<typeof db>["automationRule"]["findUnique"]>>
>;

function ruleEvent(event: StoredEvent): RuleEvent | null {
  const payload = event.payload as { before?: RuleTask; after?: RuleTask };
  if (event.kind === "task.created" && payload.after)
    return { kind: "task.created", after: payload.after };
  if (event.kind === "task.changed" && payload.before && payload.after)
    return {
      kind: "task.changed",
      before: payload.before,
      after: payload.after,
    };
  if (event.kind === "due.arrived" || event.kind === "due.overdue")
    return { kind: event.kind };
  return null;
}

async function today(tx: DatabaseTransaction) {
  const settings = await tx.installationSettings.findUnique({
    where: { id: "installation" },
  });
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: settings?.timezone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function describe(
  tx: DatabaseTransaction,
  board: Board,
  changes: PlannedChanges,
  notified: number,
) {
  const parts: string[] = [];
  const statusLabel = (id: string | null | undefined) =>
    fieldOptions(
      board.columns.find((field) => field.key === "status")?.config,
    ).find((option) => option.id === id)?.label ?? "no status";
  if ("statusId" in changes)
    parts.push(`Status → ${statusLabel(changes.statusId)}`);
  if (changes.priority)
    parts.push(
      `Priority → ${changes.priority.charAt(0)}${changes.priority.slice(1).toLowerCase()}`,
    );
  if ("groupId" in changes)
    parts.push(
      `Group → ${board.groups.find((group) => group.id === changes.groupId)?.name ?? "none"}`,
    );
  if (changes.assigneeIds) {
    const names = await tx.user.findMany({
      where: { id: { in: changes.assigneeIds } },
      select: { name: true },
    });
    parts.push(
      `Assignees → ${names.map((person) => person.name).join(", ") || "nobody"}`,
    );
  }
  if ("dueDate" in changes) parts.push(`Due → ${changes.dueDate ?? "cleared"}`);
  if ("startDate" in changes)
    parts.push(`Start → ${changes.startDate ?? "cleared"}`);
  if (changes.fieldValues)
    parts.push(
      `${Object.keys(changes.fieldValues).length} field${Object.keys(changes.fieldValues).length === 1 ? "" : "s"} updated`,
    );
  if (notified)
    parts.push(`Notified ${notified} ${notified === 1 ? "person" : "people"}`);
  return parts.join(". ") || "Nothing needed changing.";
}

type RunResult = {
  outcome: "APPLIED" | "SKIPPED" | "PENDING_APPROVAL";
  detail: string;
  pause?: string;
  notify?: string[];
};

/** Runs one rule for one event inside a single transaction. */
async function runRule(rule: StoredRule, event: StoredEvent) {
  return serial(async (tx): Promise<RunResult | null> => {
    const done = await tx.automationRun.findUnique({
      where: { ruleId_eventId: { ruleId: rule.id, eventId: event.id } },
    });
    if (done) return null;
    const record = async (result: RunResult) => {
      await tx.automationRun.create({
        data: {
          id: createRecordId(),
          ruleId: rule.id,
          eventId: event.id,
          taskId: event.taskId,
          outcome: result.outcome,
          detail: result.detail,
        },
      });
      if (result.pause)
        await tx.automationRule.update({
          where: { id: rule.id },
          data: { enabled: false, pausedReason: result.pause },
        });
      else if (result.outcome !== "SKIPPED" && rule.consecutiveFailures)
        await tx.automationRule.update({
          where: { id: rule.id },
          data: { consecutiveFailures: 0 },
        });
      return result;
    };
    if (event.chain.includes(rule.id))
      return record({
        outcome: "SKIPPED",
        detail: "Stopped: this rule had already run in this chain.",
      });
    if (event.depth >= AUTOMATION_MAX_DEPTH)
      return record({
        outcome: "SKIPPED",
        detail: `Stopped: rules can only trigger each other ${AUTOMATION_MAX_DEPTH} steps deep.`,
      });
    const task = await loadTask(tx, event.taskId);
    if (!task || task.archivedAt)
      return record({ outcome: "SKIPPED", detail: "The task is archived." });
    let context: Awaited<ReturnType<typeof access>>;
    try {
      context = await access(tx, rule.createdById, rule.boardId, true);
    } catch (error) {
      if (error instanceof SetupError && error.status === 503) throw error; // Maintenance: retry later rather than pausing.
      return record({
        outcome: "SKIPPED",
        detail: "The rule's creator can no longer open this board.",
        pause:
          "Its creator can no longer open this board. A manager can take it over by saving it.",
      });
    }
    if (!context.canManage)
      return record({
        outcome: "SKIPPED",
        detail: "The rule's creator no longer manages this board.",
        pause:
          "Its creator no longer manages this board. A manager can take it over by saving it.",
      });
    const current = snapshot(task) as RuleTask & { assigneeIds: string[] };
    const conditions = z
      .array(automationConditionSchema)
      .parse(rule.conditions);
    if (!conditionsMatch(conditions, current))
      return record({
        outcome: "SKIPPED",
        detail: "Conditions didn't match.",
      });
    const actions = z.array(automationActionSchema).parse(rule.actions);
    const { changes, notices } = planActions(actions, current, await today(tx));
    const people = new Set(
      (await eligiblePeople(tx, context.board)).map((person) => person.id),
    );
    let outcome: RunResult["outcome"] = "APPLIED";
    if (Object.keys(changes).length) {
      validateCore(changes, context.board, people);
      validateValues(changes.fieldValues, context.board, people);
      const policy = await readApprovalPolicy(tx, context.board);
      const proposed = actualApprovalChanges(snapshot(task), changes);
      if (needsApproval(policy, "UPDATE", proposed, context.board.columns)) {
        await submitProposal(tx, {
          boardId: rule.boardId,
          taskId: task.id,
          authorId: rule.createdById,
          operation: "UPDATE",
          requestKey: createRecordId(),
          requestDigest: digest(
            stableJson({ automation: rule.id, event: event.id }),
          ),
          changes: proposed,
          baseline: snapshot(task),
          policy,
          eligible: people,
          sourceRevision: task.revision,
        });
        outcome = "PENDING_APPROVAL";
      } else
        await applyTaskRecord(
          tx,
          task,
          context,
          people,
          rule.createdById,
          "update",
          changes as Parameters<typeof applyTaskRecord>[6],
          undefined,
          `Automation · ${rule.name}`,
          { depth: event.depth + 1, chain: [...event.chain, rule.id] },
        );
    }
    const assignees = changes.assigneeIds ?? current.assigneeIds;
    const recipients = [
      ...new Set(
        notices.flatMap((notice) =>
          notice.to === "assignees"
            ? assignees
            : notice.to === "creator"
              ? [task.createdById]
              : notice.userIds,
        ),
      ),
    ].filter((id) => people.has(id));
    if (recipients.length)
      await createNotifications(tx, {
        recipientIds: recipients,
        actorId: rule.createdById,
        boardId: rule.boardId,
        taskId: task.id,
        kind: "AUTOMATION",
        message: `ran the “${rule.name}” rule on`,
        eventKey: `automation:${rule.id}:${event.id}`,
        includeActor: true,
      });
    const detail = await describe(
      tx,
      context.board,
      changes,
      recipients.length,
    );
    return record({
      outcome,
      detail:
        outcome === "PENDING_APPROVAL"
          ? `Sent for approval: ${detail}`
          : detail,
      notify: recipients,
    });
  });
}

/** Records a failure outside the failed transaction; pauses after a streak. */
async function recordFailure(
  rule: StoredRule,
  event: StoredEvent,
  error: unknown,
) {
  const message =
    error instanceof SetupError
      ? error.message
      : "Something went wrong while running this rule.";
  await serial(async (tx) => {
    const existing = await tx.automationRun.findUnique({
      where: { ruleId_eventId: { ruleId: rule.id, eventId: event.id } },
    });
    if (existing) return;
    await tx.automationRun.create({
      data: {
        id: createRecordId(),
        ruleId: rule.id,
        eventId: event.id,
        taskId: event.taskId,
        outcome: "FAILED",
        detail: message,
      },
    });
    const updated = await tx.automationRule.update({
      where: { id: rule.id },
      data: { consecutiveFailures: { increment: 1 } },
    });
    if (
      updated.consecutiveFailures >= PAUSE_AFTER_FAILURES &&
      updated.enabled
    ) {
      await tx.automationRule.update({
        where: { id: rule.id },
        data: {
          enabled: false,
          pausedReason: `Paused after ${PAUSE_AFTER_FAILURES} failures in a row. Last error: ${message}`,
        },
      });
      await createNotifications(tx, {
        recipientIds: [rule.createdById],
        actorId: rule.createdById,
        boardId: rule.boardId,
        taskId: event.taskId,
        kind: "AUTOMATION",
        message: `paused the “${rule.name}” rule after repeated failures, last on`,
        eventKey: `automation:${rule.id}:paused:${event.id}`,
        includeActor: true,
      });
    }
  });
}

/**
 * Processes queued events, oldest first. Safe to run from several workers:
 * a run is unique per (rule, event), so a repeat is a no-op.
 */
export async function processAutomationEvents(limit = 50) {
  const events = await db().automationEvent.findMany({
    where: { processedAt: null, attempts: { lt: 5 } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const event of events) {
    await db().automationEvent.update({
      where: { id: event.id },
      data: { attempts: { increment: 1 } },
    });
    const matchable = ruleEvent(event);
    const rules = matchable
      ? await db().automationRule.findMany({
          where: {
            boardId: event.boardId,
            enabled: true,
            createdAt: { lte: event.createdAt },
          },
          orderBy: { createdAt: "asc" },
        })
      : [];
    let retry = false;
    for (const rule of rules) {
      const trigger = automationTriggerSchema.safeParse(rule.trigger);
      if (!trigger.success || !triggerMatches(trigger.data, matchable!))
        continue;
      try {
        const result = await runRule(rule, event);
        if (result)
          await notifyBoardMutation(
            {
              boardId: event.boardId,
              taskId: event.taskId,
              affectedUserIds: result.notify ?? [],
            },
            { boardId: event.boardId },
          );
      } catch (error) {
        if (error instanceof SetupError && error.status === 503) {
          retry = true;
          continue;
        }
        await recordFailure(rule, event, error);
      }
    }
    if (!retry)
      await db().automationEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
  }
  return events.length;
}

/**
 * Queues due-date events for boards with due triggers. Each task fires once
 * per due date; overdue looks back a week so a long backlog doesn't flood.
 */
export async function scanDueAutomations() {
  const rules = await db().automationRule.findMany({
    where: { enabled: true },
    select: { boardId: true, trigger: true },
  });
  const boards = new Map<string, Set<"due.arrived" | "due.overdue">>();
  for (const rule of rules) {
    const trigger = automationTriggerSchema.safeParse(rule.trigger);
    if (
      trigger.success &&
      (trigger.data.kind === "due.arrived" ||
        trigger.data.kind === "due.overdue")
    )
      boards.set(
        rule.boardId,
        (boards.get(rule.boardId) ?? new Set()).add(trigger.data.kind),
      );
  }
  if (!boards.size) return 0;
  const day = await today(db() as unknown as DatabaseTransaction);
  const todayDate = new Date(`${day}T00:00:00Z`);
  const weekAgo = new Date(todayDate.getTime() - 7 * 86_400_000);
  let queued = 0;
  for (const [boardId, kinds] of boards)
    for (const kind of kinds) {
      const tasks = await db().task.findMany({
        where: {
          boardId,
          archivedAt: null,
          dueDate:
            kind === "due.arrived"
              ? todayDate
              : { lt: todayDate, gte: weekAgo },
          ...(kind === "due.overdue"
            ? { OR: [{ statusId: null }, { statusId: { not: "done" } }] }
            : {}),
        },
        select: { id: true, dueDate: true },
        take: 500,
      });
      if (!tasks.length) continue;
      const created = await db().automationEvent.createMany({
        data: tasks.map((task) => ({
          id: createRecordId(),
          boardId,
          taskId: task.id,
          kind,
          dedupeKey: `${kind}:${task.id}:${task.dueDate!.toISOString().slice(0, 10)}`,
        })),
        skipDuplicates: true,
      });
      queued += created.count;
    }
  return queued;
}

/** Drops history and processed events past the retention window. */
export async function pruneAutomationHistory() {
  await db().automationRun.deleteMany({
    where: { createdAt: { lt: since() } },
  });
  await db().automationEvent.deleteMany({
    where: { processedAt: { lt: since() } },
  });
}

/** Polls the queue, scans due dates each minute and prunes hourly. */
export function startAutomationWorker() {
  let stopped = false;
  let running = false;
  let lastScan = 0;
  let lastPrune = 0;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      if (Date.now() - lastScan > 60_000) {
        lastScan = Date.now();
        await scanDueAutomations();
      }
      while (!stopped && (await processAutomationEvents()) === 50);
      if (Date.now() - lastPrune > 3_600_000) {
        lastPrune = Date.now();
        await pruneAutomationHistory();
      }
    } catch {
      console.error(JSON.stringify({ event: "automation_worker_error" }));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 2_000);
  void tick();
  return {
    close: async () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
