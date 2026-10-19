import { boardPaginationSchema, type BoardPagination } from "./board-query";
import { savedViewSchema, type SavedView } from "./saved-view-contract";
import { z } from "zod";
import { recordId, personId } from "./id-contract";
export { recordId, personId } from "./id-contract";
import {
  approvalPolicySchema,
  pendingApprovalSchema,
  type ApprovalPolicy,
  type PendingApproval,
} from "./approval-contract";
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Use a valid date.");
export const fieldTypes = [
  "TEXT",
  "LONG_TEXT",
  "NUMBER",
  "STATUS",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "TAGS",
  "DATE",
  "CHECKBOX",
  "PEOPLE",
  "URL",
  "EMAIL",
] as const;
export const priorities = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const coreKeys = [
  "name",
  "description",
  "status",
  "assignees",
  "priority",
  "start_date",
  "due_date",
];
const names = z.string().trim().min(1).max(200);
export const checklistSchema = z
  .array(
    z
      .object({
        id: recordId,
        text: z.string().trim().min(1).max(300),
        done: z.boolean(),
      })
      .strict(),
  )
  .max(100)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    "Give each checklist item a unique ID.",
  );
export type TaskChecklist = z.infer<typeof checklistSchema>;
const ids = z
  .array(personId)
  .max(50)
  .refine(
    (items) => new Set(items).size === items.length,
    "Choose each person once.",
  );
const changes = z
  .object({
    name: names,
    description: z.string().max(10000),
    checklist: checklistSchema,
    statusId: z.string().max(100).nullable(),
    priority: z.enum(priorities),
    startDate: dateOnly.nullable(),
    dueDate: dateOnly.nullable(),
    groupId: recordId.nullable(),
    assigneeIds: ids,
    fieldValues: z.record(recordId, z.unknown()),
  })
  .strict();
export const createTaskSchema = changes
  .partial()
  .extend({ boardId: recordId, createKey: recordId, name: names })
  .strict();
export const updateTaskSchema = z
  .object({
    taskId: recordId,
    requestKey: recordId.optional(),
    revision: z.number().int().positive(),
    changes: changes
      .partial()
      .refine(
        (value) => Object.keys(value).length > 0,
        "Change at least one field.",
      ),
  })
  .strict();
export const taskActionSchema = z
  .object({
    taskId: recordId,
    revision: z.number().int().positive(),
    requestKey: recordId.optional(),
  })
  .strict();
/** Places a task between two neighbours in a lane; either may be absent. */
export const reorderTaskSchema = z
  .object({
    taskId: recordId,
    afterId: recordId.nullable(),
    beforeId: recordId.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.afterId !== value.taskId &&
      value.beforeId !== value.taskId &&
      (value.afterId === null || value.afterId !== value.beforeId),
    "Choose a different place for this task.",
  );
export const editorGrantSchema = taskActionSchema
  .extend({ userId: personId, grant: z.boolean() })
  .strict();
export const fieldSchema = z
  .object({
    boardId: recordId,
    name: z.string().trim().min(1).max(80),
    type: z.enum(fieldTypes),
    options: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  })
  .strict();
export const groupSchema = z
  .object({ boardId: recordId, name: z.string().trim().min(1).max(80) })
  .strict();
// A board is created either standalone in a workspace or inside a project.
export const boardCreateSchema = z.union([
  z
    .object({ workspaceId: recordId, name: z.string().trim().min(1).max(100) })
    .strict(),
  z
    .object({ projectId: recordId, name: z.string().trim().min(1).max(100) })
    .strict(),
]);
export const statusIcons = [
  "circle",
  "circle-dot",
  "clock",
  "check-circle",
  "rotate-ccw",
  "ban",
  "flag",
  "alert-circle",
] as const;
export const optionAppearanceSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  icon: z.enum(statusIcons).optional(),
});
export type BoardOption = {
  id: string;
  label: string;
  color?: string;
  icon?: (typeof statusIcons)[number];
};
export const optionSchema = optionAppearanceSchema.extend({
  id: z.string().optional(),
  label: z.string(),
});
export function fieldOptions(config: unknown) {
  const parsed = z.object({ options: z.array(optionSchema) }).safeParse(config);
  return parsed.success
    ? parsed.data.options.map((option) => ({
        ...option,
        id: option.id ?? option.label,
      }))
    : [];
}
export type FieldValue = string | number | boolean | string[] | null;
export type BoardField = {
  version: string;
  id: string;
  key: string;
  name: string;
  type: string;
  options: BoardOption[];
};
export type BoardTask = {
  id: string;
  name: string;
  description: string;
  checklist: TaskChecklist;
  statusId: string | null;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  groupId: string | null;
  createdById: string;
  createdByName: string;
  revision: number;
  /** Manual order on the board. */
  position?: number;
  archivedAt: string | null;
  assigneeIds: string[];
  editorIds: string[];
  fieldValues: Record<string, FieldValue>;
  canEdit: boolean;
  commentCount?: number;
  attachmentCount?: number;
  activity: { id: string; action: string; actor: string; createdAt: string }[];
};
export type BoardState = {
  pagination?: BoardPagination;
  focusedTask?: BoardTask | null;
  pendingApprovalCount?: number;
  /** Whole-board totals for the pulse bar, ignoring filters. */
  pulse?: { statusCounts: Record<string, number>; overdue: number };
  groupTaskCounts?: Record<string, number>;
  calendarDate?: string;
  savedViews?: SavedView[];
  selectedViewId?: string | null;
  boardId: string;
  canManage: boolean;
  canManageManagers: boolean;
  managerIds: string[];
  currentUserId: string;
  groups: { id: string; name: string }[];
  fields: BoardField[];
  people: {
    id: string;
    name: string;
    image?: string | null;
    deactivated?: boolean;
  }[];
  tasks: BoardTask[];
  approvalPolicy: ApprovalPolicy;
  pendingApprovals: PendingApproval[];
};

const baseBoardStateSchema = z.object({
  calendarDate: dateOnly.optional(),
  savedViews: z.array(savedViewSchema).default([]),
  selectedViewId: recordId.nullable().default(null),
  boardId: recordId,
  approvalPolicy: approvalPolicySchema,
  pendingApprovals: z.array(pendingApprovalSchema),
  canManage: z.boolean(),
  canManageManagers: z.boolean(),
  managerIds: z.array(personId),
  currentUserId: personId,
  groups: z.array(z.object({ id: recordId, name: z.string() })),
  fields: z.array(
    z.object({
      id: recordId,
      version: z.string(),
      key: z.string(),
      name: z.string(),
      type: z.string(),
      options: z.array(
        optionAppearanceSchema.extend({ id: z.string(), label: z.string() }),
      ),
    }),
  ),
  people: z.array(
    z.object({
      id: personId,
      name: z.string(),
      image: z.string().nullable().optional(),
      /** Deactivated people keep their name on work but can't be chosen. */
      deactivated: z.boolean().optional(),
    }),
  ),
  tasks: z.array(
    z.object({
      id: recordId,
      name: z.string(),
      description: z.string(),
      checklist: checklistSchema.default([]),
      statusId: z.string().nullable(),
      priority: z.string(),
      // Older cached payloads and fixtures may lack the field.
      startDate: z.string().nullable().default(null),
      dueDate: z.string().nullable(),
      groupId: recordId.nullable(),
      createdById: personId,
      createdByName: z.string(),
      revision: z.number().int().positive(),
      position: z.number().optional(),
      archivedAt: z.string().nullable(),
      assigneeIds: z.array(personId),
      editorIds: z.array(personId),
      fieldValues: z.record(
        recordId,
        z
          .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
          .nullable(),
      ),
      canEdit: z.boolean(),
      commentCount: z.number().int().nonnegative().default(0),
      attachmentCount: z.number().int().nonnegative().default(0),
      activity: z.array(
        z.object({
          id: recordId,
          action: z.string(),
          actor: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
  ),
});

export const boardStateSchema = baseBoardStateSchema.extend({
  pagination: boardPaginationSchema.optional(),
  groupTaskCounts: z
    .record(z.string(), z.number().int().nonnegative())
    .optional(),
  focusedTask: baseBoardStateSchema.shape.tasks.element.nullable().optional(),
  pendingApprovalCount: z.number().int().nonnegative().optional(),
  pulse: z
    .object({
      statusCounts: z.record(z.string(), z.number().int().nonnegative()),
      overdue: z.number().int().nonnegative(),
    })
    .optional(),
});

export const configureFieldSchema = z
  .object({
    boardId: recordId,
    fieldId: recordId,
    version: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().min(1).max(80),
    options: z
      .array(
        optionAppearanceSchema.extend({
          id: z.string().min(1).max(100),
          label: z.string().trim().min(1).max(80),
        }),
      )
      .max(50),
  })
  .strict();
export const renameGroupSchema = z
  .object({
    boardId: recordId,
    groupId: recordId,
    expectedName: z.string(),
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export const removeGroupSchema = renameGroupSchema
  .pick({ boardId: true, groupId: true, expectedName: true })
  .strict();

export const boardManagerSchema = z
  .object({ boardId: recordId, userId: personId, grant: z.boolean() })
  .strict();

export const removeFieldSchema = configureFieldSchema
  .pick({ boardId: true, fieldId: true, version: true })
  .strict();

export const commentCreateSchema = z
  .object({
    taskId: recordId,
    createKey: recordId,
    body: z.string().trim().min(1).max(5000),
    mentionIds: ids.default([]),
  })
  .strict();
export const commentsSchema = z.array(
  z.object({
    id: recordId,
    authorId: personId,
    authorName: z.string(),
    body: z.string(),
    createdAt: z.string(),
    revision: z.number().int().positive(),
    mentions: z.array(z.object({ id: personId, name: z.string() })),
    deletedAt: z.string().nullable(),
    canEdit: z.boolean(),
    canRemove: z.boolean(),
  }),
);
export const commentChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("edit"),
      commentId: recordId,
      revision: z.number().int().positive(),
      body: z.string().trim().min(1).max(5000),
      mentionIds: ids.default([]),
    })
    .strict(),
  z
    .object({
      action: z.literal("remove"),
      commentId: recordId,
      revision: z.number().int().positive(),
    })
    .strict(),
]);
export const commentHistorySchema = z.array(
  z.object({
    revision: z.number().int().positive(),
    action: z.string(),
    body: z.string(),
    actorName: z.string(),
    createdAt: z.string(),
  }),
);
