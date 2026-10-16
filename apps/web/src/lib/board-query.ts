import { z } from "zod";
import { viewConfigSchema } from "./saved-view-contract";

export const BOARD_PAGE_SIZE = 100;
export const boardQuerySchema = z
  .object({
    config: viewConfigSchema.optional(),
    page: z.number().int().min(1).max(1_000_000).default(1),
    taskId: z.string().uuid().optional(),
    selectedView: z.boolean().optional(),
  })
  .strict();
export type BoardQuery = z.input<typeof boardQuerySchema>;
export const boardPaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.literal(100),
  total: z.number().int().nonnegative(),
  pageCount: z.number().int().positive(),
  statusCounts: z.record(z.string(), z.number().int().nonnegative()),
  config: viewConfigSchema.nullable(),
});
export type BoardPagination = z.infer<typeof boardPaginationSchema>;
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
export function calendarWindow(today: string) {
  const start = new Date(`${today}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}
