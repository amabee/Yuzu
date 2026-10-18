import { z } from "zod";
import { optionAppearanceSchema } from "./board-contract";

// The same stable status ID used by the task sheet's Mark as done action.
export const COMPLETED_STATUS_ID = "done";
export const DASHBOARD_BOARD_PAGE_SIZE = 12;
export const dashboardQuerySchema = z
  .object({
    workspaceId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  })
  .strict();
const count = z.number().int().nonnegative();
const deadline = z.object({
  id: z.string().uuid(),
  name: z.string(),
  boardId: z.string().uuid(),
  boardName: z.string(),
  workspaceName: z.string(),
  dueDate: z.string(),
});
export const dashboardSchema = z.object({
  calendarDate: z.string(),
  upcomingEnd: z.string(),
  total: count,
  open: count,
  completed: count,
  overdue: count,
  upcomingCount: count,
  unassigned: count,
  boardCount: count,
  page: z.number().int().positive(),
  pageCount: z.number().int().positive(),
  boards: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        workspaceName: z.string(),
        total: count,
        overdue: count,
        statuses: z.array(
          optionAppearanceSchema.extend({
            id: z.string().nullable(),
            label: z.string(),
            count,
          }),
        ),
      }),
    )
    .max(DASHBOARD_BOARD_PAGE_SIZE),
  upcoming: z.array(deadline).max(10),
  overdueTasks: z.array(deadline).max(10),
  workload: z
    .array(
      z.object({
        userId: z.string(),
        name: z.string(),
        image: z.string().nullable(),
        count,
        overdue: count,
      }),
    )
    .max(12),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
