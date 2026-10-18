import { z } from "zod";

export const viewConfigSchema = z
  .object({
    layout: z.enum(["board", "table", "calendar"]),
    search: z.string().max(200),
    groupId: z.string().uuid().nullable(),
    statusId: z.string().min(1).max(100).nullable(),
    sort: z.enum(["created", "name", "due"]),
    archived: z.boolean(),
    assignee: z.enum(["all", "me", "unassigned"]),
    priority: z.enum(["all", "LOW", "NORMAL", "HIGH", "URGENT"]),
    due: z.enum(["all", "overdue", "next-week", "none"]),
  })
  .strict();
export type ViewConfig = z.infer<typeof viewConfigSchema>;
export const defaultViewConfig: ViewConfig = {
  layout: "board",
  search: "",
  groupId: null,
  statusId: null,
  sort: "created",
  archived: false,
  assignee: "all",
  priority: "all",
  due: "all",
};
export const savedViewSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string(),
  name: z.string(),
  visibility: z.enum(["PERSONAL", "SHARED"]),
  revision: z.number().int().positive(),
  config: viewConfigSchema,
});
export type SavedView = z.infer<typeof savedViewSchema>;
export const saveViewSchema = z
  .object({
    boardId: z.string().uuid(),
    id: z.string().uuid(),
    revision: z.number().int().min(0),
    name: z.string().trim().min(1).max(80),
    visibility: z.enum(["PERSONAL", "SHARED"]),
    config: viewConfigSchema,
  })
  .strict();
export const selectViewSchema = z
  .object({ boardId: z.string().uuid(), viewId: z.string().uuid().nullable() })
  .strict();
export const removeViewSchema = z
  .object({
    boardId: z.string().uuid(),
    id: z.string().uuid(),
    revision: z.number().int().positive(),
  })
  .strict();

// Compare calendar dates; the board supplies today in the installation timezone.
export function dueMatches(
  dueDate: string | null,
  filter: ViewConfig["due"],
  now = new Date(),
) {
  if (filter === "all") return true;
  if (filter === "none") return !dueDate;
  if (!dueDate) return false;
  const day = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = day(now);
  if (filter === "overdue") return dueDate < today;
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  return dueDate >= today && dueDate <= day(end);
}
