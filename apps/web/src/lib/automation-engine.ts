import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
} from "./automation-contract";
import type { FieldValue } from "./board-contract";

/** The parts of a task snapshot that rules read and write. */
export type RuleTask = {
  statusId: string | null;
  priority: string;
  groupId: string | null;
  assigneeIds: string[];
  startDate: string | null;
  dueDate: string | null;
  fieldValues: Record<string, FieldValue>;
  /** Checklist progress, when the event recorded it. */
  checklist?: { done: number; total: number };
};

export type RuleEvent =
  | { kind: "task.created"; after: RuleTask }
  | { kind: "task.changed"; before: RuleTask; after: RuleTask }
  | { kind: "comment.added"; after: RuleTask; mentions: string[] }
  | { kind: "due.arrived" | "due.overdue" | "schedule" };

const complete = (task: RuleTask) =>
  Boolean(task.checklist?.total) &&
  task.checklist!.done === task.checklist!.total;

const has = (value: FieldValue | undefined, option: string) =>
  Array.isArray(value) ? value.includes(option) : value === option;

/** Whether a rule's trigger fires for this event. */
export function triggerMatches(trigger: AutomationTrigger, event: RuleEvent) {
  switch (trigger.kind) {
    case "task.created":
    case "due.arrived":
    case "due.overdue":
    case "schedule":
      return event.kind === trigger.kind;
    case "comment.added":
      return (
        event.kind === "comment.added" &&
        (!trigger.mentionsOnly || event.mentions.length > 0)
      );
    case "checklist.completed":
      return (
        event.kind === "task.changed" &&
        complete(event.after) &&
        !complete(event.before)
      );
    case "status.changed":
      return (
        event.kind === "task.changed" &&
        event.before.statusId !== event.after.statusId &&
        event.after.statusId === trigger.to &&
        (trigger.from === null || event.before.statusId === trigger.from)
      );
    case "assignee.added": {
      if (event.kind !== "task.changed" && event.kind !== "task.created")
        return false;
      const before = event.kind === "task.changed" ? event.before : null;
      const added = event.after.assigneeIds.filter(
        (id) => !before?.assigneeIds.includes(id),
      );
      return trigger.userId === null
        ? added.length > 0
        : added.includes(trigger.userId);
    }
    case "field.changed": {
      if (event.kind !== "task.changed") return false;
      const { before, after } = event;
      if (trigger.field === "priority")
        return (
          before.priority !== after.priority && after.priority === trigger.value
        );
      if (trigger.field === "group")
        return (
          before.groupId !== after.groupId && after.groupId === trigger.value
        );
      return (
        has(after.fieldValues[trigger.field], trigger.value) &&
        !has(before.fieldValues[trigger.field], trigger.value)
      );
    }
  }
}

/** Whether every condition holds for the task as it is now. */
export function conditionsMatch(
  conditions: AutomationCondition[],
  task: RuleTask,
  match: "all" | "any" = "all",
) {
  if (!conditions.length) return true;
  return conditions[match === "all" ? "every" : "some"]((condition) => {
    switch (condition.subject) {
      case "status":
      case "priority":
      case "group": {
        const current =
          condition.subject === "status"
            ? task.statusId
            : condition.subject === "priority"
              ? task.priority
              : task.groupId;
        return (current === condition.value) === (condition.op === "is");
      }
      case "assignees":
        return condition.op === "empty"
          ? task.assigneeIds.length === 0
          : task.assigneeIds.includes(condition.userId!);
      case "field": {
        const value = task.fieldValues[condition.fieldId];
        const matches =
          typeof condition.value === "boolean"
            ? (value === true) === condition.value
            : has(value, condition.value);
        return matches === (condition.op === "is");
      }
      case "due":
        return Boolean(task.dueDate) === (condition.op === "set");
    }
  });
}

export type PlannedChanges = {
  statusId?: string | null;
  priority?: string;
  groupId?: string | null;
  assigneeIds?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  fieldValues?: Record<string, FieldValue>;
};

export type PlannedNotice = {
  message?: string;
  replaceDefault?: boolean;
  to: "assignees" | "creator" | "people";
  userIds: string[];
};

/**
 * Turns actions into task changes (only what actually differs) and the
 * notices to send. `today` is YYYY-MM-DD in the installation timezone.
 */
export function planActions(
  actions: AutomationAction[],
  task: RuleTask,
  today: string,
) {
  const next: RuleTask = {
    ...task,
    assigneeIds: [...task.assigneeIds],
    fieldValues: { ...task.fieldValues },
  };
  const notices: PlannedNotice[] = [];
  const creations: Extract<AutomationAction, { kind: "create.task" }>[] = [];
  const webhooks: string[] = [];
  const emails: Extract<AutomationAction, { kind: "email" }>[] = [];
  for (const action of actions) {
    switch (action.kind) {
      case "set.status":
        next.statusId = action.value;
        break;
      case "set.priority":
        next.priority = action.value;
        break;
      case "set.group":
        next.groupId = action.value;
        break;
      case "assign":
        if (!next.assigneeIds.includes(action.userId))
          next.assigneeIds.push(action.userId);
        break;
      case "unassign":
        next.assigneeIds = next.assigneeIds.filter(
          (id) => id !== action.userId,
        );
        break;
      case "set.field":
        next.fieldValues[action.fieldId] = action.value;
        break;
      case "set.date": {
        const date = action.days === null ? null : addDays(today, action.days);
        if (action.field === "dueDate") next.dueDate = date;
        else if (action.field === "startDate") next.startDate = date;
        else next.fieldValues[action.field] = date;
        break;
      }
      case "notify":
        notices.push({
          to: action.to,
          userIds: action.userIds ?? [],
          ...(action.message ? { message: action.message } : {}),
          ...(action.replaceDefault ? { replaceDefault: true } : {}),
        });
        break;
      case "create.task":
        creations.push(action);
        break;
      case "webhook":
        webhooks.push(action.url);
        break;
      case "email":
        emails.push(action);
        break;
    }
  }
  const changes: PlannedChanges = {};
  for (const key of [
    "statusId",
    "priority",
    "groupId",
    "startDate",
    "dueDate",
  ] as const)
    if (next[key] !== task[key])
      (changes as Record<string, unknown>)[key] = next[key];
  if (
    next.assigneeIds.length !== task.assigneeIds.length ||
    next.assigneeIds.some((id) => !task.assigneeIds.includes(id))
  )
    changes.assigneeIds = next.assigneeIds;
  const fieldValues = Object.fromEntries(
    Object.entries(next.fieldValues).filter(
      ([id, value]) =>
        JSON.stringify(value ?? null) !==
        JSON.stringify(task.fieldValues[id] ?? null),
    ),
  );
  if (Object.keys(fieldValues).length) changes.fieldValues = fieldValues;
  return { changes, notices, creations, webhooks, emails };
}

export function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
