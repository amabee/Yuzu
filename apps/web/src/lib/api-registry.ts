import { z } from "zod";
import {
  boardArchiveSchema,
  commentChangeSchema,
  commentCreateSchema,
  publicCreateTaskSchema,
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
import {
  crmDirectoryQuerySchema,
  crmMatchQuerySchema,
  linkCreateSchema,
  linkPrimarySchema,
  linkRemoveSchema,
  linkUpdateSchema,
} from "./crm-contract";
import { pipelineCreateSchema, stageCommandSchema } from "./deal-contract";

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
    method: "POST",
    path: "/boards/archive-board",
    group: "Boards and tasks",
    summary: "Archive or restore a board",
    access: "write",
    body: boardArchiveSchema,
    returns: "Board id and archive state; managers only, version checked",
  },
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
      "Works for every board type (tasks, deals, custom records). createKey is a UUID you choose; send the same one again to safely retry. Built-in fields a board has turned off are refused, and a deal takes one owner.",
    access: "write",
    body: publicCreateTaskSchema,
    returns: "The new task's id",
  },
  {
    method: "POST",
    path: "/boards/update",
    group: "Boards and tasks",
    summary: "Change a task",
    description:
      "Send the task's current revision. If someone changed it since, you get 409 and nothing is overwritten. Changes that need approval become a request. On CRM pipelines with approvals on, send a stage move on its own: moves the pipeline's stage rule covers become a stage request, one per deal at a time.",
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
    method: "GET",
    path: "/boards/subitems",
    group: "Boards and tasks",
    summary: "List a task’s subitems",
    access: "read",
    query: z.object({
      boardId: recordId,
      parentId: recordId,
      cursor: recordId.optional(),
      archived: z.enum(["true", "false"]).optional(),
    }),
    returns: "A page of 50 subitems, summary and cursor",
  },
  {
    method: "POST",
    path: "/boards/reorder-subitem",
    group: "Boards and tasks",
    summary: "Reorder siblings",
    access: "write",
    body: reorderTaskSchema,
    returns: "The subitem’s board and id",
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
    path: "/boards/link-options",
    group: "Boards and tasks",
    summary: "Records you can link through a link field",
    description:
      "Set links by sending the chosen record ids as the link field's value in fieldValues. Links to records you can't see are kept as they are.",
    access: "read",
    query: z.object({
      fieldId: recordId,
      q: z.string().max(200).optional(),
    }),
    returns: "Up to 20 matching records",
  },
  {
    method: "POST",
    path: "/trash/delete-record",
    group: "Boards and tasks",
    summary: "Move a record to Trash",
    description:
      "Board managers and admins only. The record disappears everywhere until restored.",
    access: "write",
    body: z.object({
      id: recordId,
      revision: z.number().int().positive().optional(),
      childrenRevision: z.number().int().nonnegative().optional(),
    }),
    returns: "The board and record ids",
  },
  {
    method: "POST",
    path: "/trash/restore-record",
    group: "Boards and tasks",
    summary: "Restore a record from Trash",
    description:
      "Set withParents to also restore its board and project if they're in Trash.",
    access: "write",
    body: z.object({ id: recordId, withParents: z.boolean().optional() }),
    returns: "The board and record ids",
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
  {
    method: "GET",
    path: "/crm/directory",
    group: "CRM",
    summary: "A page of Companies or Contacts",
    description:
      "One page (50) of the workspace's Companies or Contacts, with whole-collection totals. Records are created and changed with the task create and update endpoints, using the returned boardId; profile fields (email, phone, domain, website, legalName, address) go alongside name.",
    access: "read",
    query: z.object({
      workspaceId: recordId,
      query: z
        .string()
        .optional()
        .describe(
          `Optional JSON object with: ${Object.keys(crmDirectoryQuerySchema.shape).join(", ")}`,
        ),
    }),
    returns: "The collection's board id, people and a page of records",
  },
  {
    method: "GET",
    path: "/crm/record",
    group: "CRM",
    summary: "One Company or Contact",
    access: "read",
    query: id("recordId"),
    returns: "The record, its profile and recent changes",
  },
  {
    method: "GET",
    path: "/crm/matches",
    group: "CRM",
    summary: "Records that look like a new one",
    description:
      "Duplicate suggestions by email, domain and similar name, among records you can see. Suggestions never block creating a record.",
    access: "read",
    query: z.object({
      workspaceId: recordId,
      query: z
        .string()
        .describe(
          `JSON object with: ${Object.keys(crmMatchQuerySchema.shape).join(", ")}`,
        ),
    }),
    returns: "Up to five matching records",
  },
  {
    method: "GET",
    path: "/crm/links",
    group: "CRM",
    summary: "A contact's companies or a company's people",
    description:
      "One page (50) of links: primary first, then current, then former. Links to records you can't see show as private on contacts and are left out on companies.",
    access: "read",
    query: z.object({
      recordId,
      page: z.string().optional().describe("Page number, from 1"),
    }),
    returns: "Links with roles, status and the primary revision",
  },
  {
    method: "POST",
    path: "/crm/link",
    group: "CRM",
    summary: "Link a contact to a company",
    description:
      "Needs edit access to the contact and sight of the company. An existing pair comes back as ALREADY_LINKED, unchanged. Unavailable while the Contacts board requires approvals.",
    access: "write",
    body: linkCreateSchema,
    returns: "The link, with both records' board ids",
  },
  {
    method: "POST",
    path: "/crm/update-link",
    group: "CRM",
    summary: "Change a link's role or status",
    access: "write",
    body: linkUpdateSchema,
    returns: "The link's new revision",
  },
  {
    method: "POST",
    path: "/crm/remove-link",
    group: "CRM",
    summary: "Remove a link",
    access: "write",
    body: linkRemoveSchema,
    returns: "The contact's primary revision",
  },
  {
    method: "POST",
    path: "/crm/primary",
    group: "CRM",
    summary: "Choose or clear a contact's primary company",
    access: "write",
    body: linkPrimarySchema,
    returns: "The new primary revision",
  },
  {
    method: "GET",
    path: "/crm/pipelines",
    group: "CRM deals",
    summary: "A workspace's pipelines",
    access: "read",
    query: id("workspaceId"),
    returns: "Pipelines with their open deals' count and value per currency",
  },
  {
    method: "GET",
    path: "/crm/pipeline",
    group: "CRM deals",
    summary: "A pipeline's stages",
    access: "read",
    query: id("boardId"),
    returns:
      "Stages with categories, live-deal counts and totals, and the pipeline version",
  },
  {
    method: "POST",
    path: "/crm/pipeline",
    group: "CRM deals",
    summary: "Create a pipeline",
    description:
      "Administrators and board managers in the workspace create pipelines. They start with New, Qualified, Proposal, Negotiation, Won and Lost.",
    access: "write",
    body: pipelineCreateSchema,
    returns: "The pipeline's board id",
  },
  {
    method: "POST",
    path: "/crm/stages",
    group: "CRM deals",
    summary: "Change a pipeline's stages",
    description:
      "Add, rename, recategorize, move or remove a stage, choose the default, or set which stage moves need approval (CLOSING or ALL), against the pipeline version. A pipeline keeps an Open, a Won and a Lost stage; stages used by deals or waiting stage requests can't be removed or recategorized.",
    access: "write",
    body: stageCommandSchema,
    returns: "The new pipeline version",
  },
  {
    method: "GET",
    path: "/crm/deal-lanes",
    group: "CRM deals",
    summary: "A pipeline's deals by stage",
    description:
      "The first 50 deals of each stage, with whole-stage counts. Create and change deals with the task create and update endpoints, using stageId, amount, currency, customerCompanyId or customerContactId alongside name.",
    access: "read",
    query: z.object({
      query: z.string().describe("JSON object with: boardId, q, archived"),
    }),
    returns: "Lanes of deals",
  },
  {
    method: "GET",
    path: "/crm/deals",
    group: "CRM deals",
    summary: "A page of a pipeline's deals",
    access: "read",
    query: z.object({
      query: z
        .string()
        .describe(
          "JSON object with: boardId, q, archived, stageId, sort, page",
        ),
    }),
    returns: "One page (50) of deals with whole-filter totals",
  },
  {
    method: "GET",
    path: "/crm/deal",
    group: "CRM deals",
    summary: "One deal with its stage history",
    access: "read",
    query: id("recordId"),
    returns: "The deal and its stage history, newest first",
  },
  {
    method: "GET",
    path: "/crm/customer-deals",
    group: "CRM deals",
    summary: "Deals for a company or contact",
    access: "read",
    query: id("recordId"),
    returns: "Up to 50 deals the record is the customer of",
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
