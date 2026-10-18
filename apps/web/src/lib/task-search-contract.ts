import { z } from "zod";

export const TASK_SEARCH_PAGE_SIZE = 20;
export const taskSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(200),
    archived: z.enum(["false", "true"]).default("false"),
    cursor: z.string().uuid().optional(),
  })
  .strict();
export const taskSearchResultSchema = z.object({
  total: z.number().int().nonnegative(),
  nextCursor: z.string().uuid().nullable(),
  tasks: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        description: z.string(),
        boardId: z.string().uuid(),
        boardName: z.string(),
        workspaceName: z.string(),
        projectName: z.string().nullable(),
        archived: z.boolean(),
        dueDate: z.string().nullable(),
      }),
    )
    .max(TASK_SEARCH_PAGE_SIZE),
});
export type TaskSearchResult = z.infer<typeof taskSearchResultSchema>;
