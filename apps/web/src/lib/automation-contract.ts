import { z } from "zod";
import { personId, recordId } from "./board-contract";
import { scheduleSchema } from "./automation-schedule";

/** Status, priority and option ids are short stable strings, not UUIDs. */
const optionId = z.string().trim().min(1).max(100);

export const automationTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task.created") }).strict(),
  z
    .object({
      kind: z.literal("status.changed"),
      /** null means from any status. */
      from: optionId.nullable(),
      to: optionId,
    })
    .strict(),
  z
    .object({
      kind: z.literal("assignee.added"),
      /** null means anyone. */
      userId: personId.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("due.arrived") }).strict(),
  z.object({ kind: z.literal("due.overdue") }).strict(),
  z.object({ kind: z.literal("schedule"), schedule: scheduleSchema }).strict(),
  z
    .object({
      kind: z.literal("comment.added"),
      /** Only when the comment mentions someone. */
      mentionsOnly: z.boolean().default(false),
    })
    .strict(),
  z.object({ kind: z.literal("checklist.completed") }).strict(),
  z
    .object({
      kind: z.literal("field.changed"),
      /** "priority", "group", or a custom dropdown/tag field id. */
      field: z.union([z.literal("priority"), z.literal("group"), recordId]),
      value: optionId,
    })
    .strict(),
]);

export const automationConditionSchema = z.discriminatedUnion("subject", [
  z
    .object({
      subject: z.enum(["status", "priority", "group"]),
      op: z.enum(["is", "is_not"]),
      /** null means "no status" or "no group". */
      value: optionId.nullable(),
    })
    .strict(),
  z
    .object({
      subject: z.literal("assignees"),
      op: z.enum(["include", "empty"]),
      userId: personId.optional(),
    })
    .strict()
    .refine(
      (value) => value.op === "empty" || Boolean(value.userId),
      "Choose a person.",
    ),
  z
    .object({
      subject: z.literal("field"),
      fieldId: recordId,
      op: z.enum(["is", "is_not"]),
      value: z.union([optionId, z.boolean()]),
    })
    .strict(),
  z
    .object({ subject: z.literal("due"), op: z.enum(["set", "unset"]) })
    .strict(),
]);

export const automationActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set.status"), value: optionId }).strict(),
  z.object({ kind: z.literal("set.priority"), value: optionId }).strict(),
  z
    .object({ kind: z.literal("set.group"), value: recordId.nullable() })
    .strict(),
  z.object({ kind: z.literal("assign"), userId: personId }).strict(),
  z.object({ kind: z.literal("unassign"), userId: personId }).strict(),
  z
    .object({
      kind: z.literal("set.field"),
      fieldId: recordId,
      /** Option id for dropdowns, option ids for tags, a boolean for checkboxes. */
      value: z
        .union([optionId, z.array(optionId).max(50), z.boolean()])
        .nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("set.date"),
      /** "dueDate", "startDate", or a custom date field id. */
      field: z.union([z.literal("dueDate"), z.literal("startDate"), recordId]),
      /** Days from the day the rule runs; null clears the date. */
      days: z.number().int().min(-365).max(365).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("notify"),
      to: z.enum(["assignees", "creator", "people"]),
      userIds: z.array(personId).max(20).optional(),
      /** Custom text; {task}, {status}, {due} and friends fill in when it runs. */
      message: z.string().trim().max(280).optional(),
      /** Send this instead of Yuzu's own assignment or mention notice. */
      replaceDefault: z.boolean().optional(),
    })
    .strict()
    .refine(
      (value) => value.to !== "people" || Boolean(value.userIds?.length),
      "Choose who to notify.",
    ),
  z
    .object({
      kind: z.literal("create.task"),
      /** Another board the rule's creator manages; null means this board. */
      boardId: recordId.nullable(),
      /** {task} is the triggering task's name, {date} the day it runs. */
      name: z.string().trim().min(1).max(200),
      statusId: optionId.nullable().optional(),
      groupId: recordId.nullable().optional(),
      assigneeIds: z.array(personId).max(20).default([]),
      /** Due date in days from the run; null leaves it empty. */
      dueInDays: z.number().int().min(-365).max(365).nullable().default(null),
    })
    .strict(),
  z
    .object({
      kind: z.literal("webhook"),
      url: z
        .string()
        .trim()
        .max(2000)
        .url("Enter a full URL, starting with https://.")
        .refine(
          (value) => /^https?:\/\//i.test(value),
          "Webhooks must use http or https.",
        ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("email"),
      to: z.enum(["assignees", "creator", "people"]),
      userIds: z.array(personId).max(20).optional(),
      /** Placeholders like {task} fill in when it runs. */
      subject: z.string().trim().max(150).optional(),
      message: z.string().trim().min(1).max(1000),
    })
    .strict()
    .refine(
      (value) => value.to !== "people" || Boolean(value.userIds?.length),
      "Choose who to email.",
    ),
]);

/** Actions that don't need a task, the only ones scheduled rules may use. */
export const tasklessActions = [
  "create.task",
  "webhook",
  "notify",
  "email",
] as const;

export const automationRuleInputSchema = z
  .object({
    boardId: recordId,
    /** Present when editing an existing rule. */
    id: recordId.optional(),
    revision: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean().default(true),
    trigger: automationTriggerSchema,
    /** Whether every condition must match, or any one. */
    match: z.enum(["all", "any"]).default("all"),
    conditions: z.array(automationConditionSchema).max(10).default([]),
    actions: z.array(automationActionSchema).min(1).max(10),
  })
  .strict()
  .refine(
    (rule) =>
      rule.trigger.kind !== "schedule" ||
      (rule.conditions.length === 0 &&
        rule.actions.every((action) =>
          action.kind === "notify" || action.kind === "email"
            ? action.to === "people"
            : (tasklessActions as readonly string[]).includes(action.kind),
        )),
    "Scheduled rules have no task, so they can only create tasks, send webhooks, or notify or email chosen people.",
  );

export const automationToggleSchema = z
  .object({
    id: recordId,
    revision: z.number().int().positive(),
    enabled: z.boolean(),
  })
  .strict();
export const automationRemoveSchema = z
  .object({ id: recordId, revision: z.number().int().positive() })
  .strict();

export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export type AutomationCondition = z.infer<typeof automationConditionSchema>;
export type AutomationAction = z.infer<typeof automationActionSchema>;
export type AutomationRuleInput = z.infer<typeof automationRuleInputSchema>;

export const automationOutcomes = [
  "APPLIED",
  "SKIPPED",
  "PENDING_APPROVAL",
  "FAILED",
] as const;

export const automationRuleSchema = z.object({
  id: recordId,
  boardId: recordId,
  name: z.string(),
  enabled: z.boolean(),
  trigger: automationTriggerSchema,
  match: z.enum(["all", "any"]),
  conditions: z.array(automationConditionSchema),
  actions: z.array(automationActionSchema),
  createdById: personId,
  createdByName: z.string(),
  revision: z.number().int().positive(),
  pausedReason: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  runCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  /** For scheduled rules: when it runs next, as an ISO time. */
  nextRunAt: z.string().nullable(),
});
export type AutomationRule = z.infer<typeof automationRuleSchema>;

export const automationRunSchema = z.object({
  id: recordId,
  /** Null for scheduled runs, which aren't about a task. */
  taskId: recordId.nullable(),
  taskName: z.string().nullable(),
  createdTask: z
    .object({ id: recordId, name: z.string(), boardId: recordId })
    .nullable(),
  deliveries: z.array(
    z.object({
      status: z.enum(["PENDING", "DELIVERED", "FAILED"]),
      responseCode: z.number().int().nullable(),
      durationMs: z.number().int().nullable(),
      attempts: z.number().int(),
      error: z.string().nullable(),
    }),
  ),
  missed: z.boolean(),
  trigger: z.string(),
  outcome: z.enum(automationOutcomes),
  detail: z.string().nullable(),
  depth: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

/** Most rules a board may hold, and how deep one rule may trigger another. */
export const AUTOMATION_RULE_LIMIT = 50;
export const AUTOMATION_MAX_DEPTH = 3;
