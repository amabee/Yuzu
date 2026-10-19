import { z } from "zod";
import {
  commentChangeSchema,
  commentCreateSchema,
  createTaskSchema,
  recordId,
  reorderTaskSchema,
  taskActionSchema,
  updateTaskSchema,
} from "./board-contract";
import { boardQuerySchema } from "./board-query";
import { calendarQuerySchema } from "./calendar-contract";
import { timelineQuerySchema } from "./timeline-contract";
import { taskSearchQuerySchema } from "./task-search-contract";
import { projectListSchema } from "./project-contract";
import { notificationActionSchema } from "./notification-contract";
import { dashboardQuerySchema } from "./dashboard-contract";
import { exportCsvSchema } from "./csv-export";

/**
 * The public API: every endpoint an API token may call. This one list drives
 * token enforcement, /api/v1/openapi.json and the in-app reference.
 */
export type ApiEndpoint = {
  method: "GET" | "POST";
  /** Under /api/v1; `{id}` marks a path segment. */
  path: string;
  group: string;
  summary: string;
  description?: string;
  /** Read endpoints work with any token; write endpoints need Read & write. */
  access: "read" | "write";
  query?: z.ZodType;
  body?: z.ZodType;
  /** What comes back in `data`, or a file. */
  returns: string;
};

const id = (name: string) => z.object({ [name]: recordId });
/** Board views take their options as JSON in a `query` parameter. */
const withViewQuery = (schema: z.ZodType) => {
  const options = Object.keys(
    z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })
      .properties ?? {},
  );
  return z.object({
    boardId: recordId,
    query: z
      .string()
      .optional()
      .describe(`Optional JSON object with: ${options.join(", ")}`),
  });
};

export const apiEndpoints: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/boards/state",
    group: "Boards and tasks",
    summary: "A board with its tasks",
    description:
      "Statuses, groups, fields and people, plus one page (100) of tasks.",
    access: "read",
    query: withViewQuery(boardQuerySchema),
    returns: "The board and a page of tasks",
  },
  {
    method: "GET",
    path: "/boards/calendar",
    group: "Boards and tasks",
    summary: "Tasks on a board's calendar",
    access: "read",
    query: withViewQuery(calendarQuerySchema),
    returns: "Tasks with dates in the range",
  },
  {
    method: "GET",
    path: "/boards/timeline",
    group: "Boards and tasks",
    summary: "Tasks on a board's timeline",
    access: "read",
    query: withViewQuery(timelineQuerySchema),
    returns: "Tasks with start and due dates",
  },
  {
    method: "POST",
    path: "/boards/create-task",
    group: "Boards and tasks",
    summary: "Create a task",
    description:
      "createKey is a UUID you choose. Send the same one again to safely retry: it returns the task already created.",
    access: "write",
    body: createTaskSchema,
    returns: "The new task's id",
  },
  {
    method: "POST",
    path: "/boards/update",
    group: "Boards and tasks",
    summary: "Change a task",
    description:
      "Send the task's current revision. If someone changed it since, you get 409 and nothing is overwritten. Changes that need approval become a request.",
    access: "write",
    body: updateTaskSchema,
    returns: "The task's new revision, or the approval request",
  },
  {
    method: "POST",
    path: "/boards/archive",
    group: "Boards and tasks",
    summary: "Archive a task",
    access: "write",
    body: taskActionSchema,
    returns: "The task's new revision",
  },
  {
    method: "POST",
    path: "/boards/restore",
    group: "Boards and tasks",
    summary: "Restore an archived task",
    access: "write",
    body: taskActionSchema,
    returns: "The task's new revision",
  },
  {
    method: "POST",
    path: "/boards/reorder",
    group: "Boards and tasks",
    summary: "Move a task between two others",
    access: "write",
    body: reorderTaskSchema,
    returns: "The task's new position",
  },
  {
    method: "GET",
    path: "/boards/comments",
    group: "Comments",
    summary: "A task's comments",
    access: "read",
    query: id("taskId"),
    returns: "Comments, oldest first",
  },
  {
    method: "GET",
    path: "/boards/comment-history",
    group: "Comments",
    summary: "Earlier versions of a comment",
    access: "read",
    query: id("commentId"),
    returns: "The comment's revisions",
  },
  {
    method: "POST",
    path: "/boards/comment",
    group: "Comments",
    summary: "Add a comment",
    description: "Mention people by including their ids in mentionIds.",
    access: "write",
    body: commentCreateSchema,
    returns: "The new comment",
  },
  {
    method: "POST",
    path: "/boards/change-comment",
    group: "Comments",
    summary: "Edit or delete your comment",
    access: "write",
    body: commentChangeSchema,
    returns: "The changed comment",
  },
  {
    method: "GET",
    path: "/search/tasks",
    group: "Search and projects",
    summary: "Find tasks you can see",
    access: "read",
    query: taskSearchQuerySchema,
    returns: "Matching tasks and a cursor for more",
  },
  {
    method: "GET",
    path: "/projects/list",
    group: "Search and projects",
    summary: "Projects in a workspace",
    access: "read",
    query: projectListSchema,
    returns: "Projects with their boards",
  },
  {
    method: "GET",
    path: "/dashboard",
    group: "Search and projects",
    summary: "A workspace's dashboard numbers",
    access: "read",
    query: dashboardQuerySchema,
    returns: "Counts and summaries",
  },
  {
    method: "GET",
    path: "/notifications/inbox",
    group: "Notifications",
    summary: "Your notifications",
    access: "read",
    query: z.object({
      filter: z.enum(["ALL", "UNREAD"]).default("ALL"),
      cursor: recordId.optional(),
    }),
    returns: "Notifications, newest first, and a cursor",
  },
  {
    method: "POST",
    path: "/notifications/change",
    group: "Notifications",
    summary: "Mark notifications read or unread, or delete them",
    access: "write",
    body: notificationActionSchema,
    returns: "What changed",
  },
  {
    method: "POST",
    path: "/boards/export",
    group: "Exports and files",
    summary: "Download a board as CSV",
    description: "Returns the CSV file itself, not JSON.",
    access: "read",
    body: exportCsvSchema,
    returns: "A CSV file",
  },
  {
    method: "GET",
    path: "/attachments/{id}",
    group: "Exports and files",
    summary: "Download a task's file",
    access: "read",
    returns: "The file",
  },
];

const pattern = (path: string) =>
  new RegExp(`^/api/v1${path.replace(/\{[^}]+\}/g, "[A-Za-z0-9_-]{1,100}")}$`);
const compiled = apiEndpoints.map((endpoint) => ({
  endpoint,
  pattern: pattern(endpoint.path),
}));

/** The public endpoint behind a request, or undefined if tokens can't use it. */
export function findApiEndpoint(method: string, pathname: string) {
  return compiled.find(
    (item) => item.endpoint.method === method && item.pattern.test(pathname),
  )?.endpoint;
}
