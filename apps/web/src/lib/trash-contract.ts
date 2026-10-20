import { z } from "zod";

/** Auto-erase choices, in days; null keeps Trash until it's emptied. */
export const trashRetentionChoices = ["30", "90", "365"] as const;

const who = z.string().nullable();
export const trashStateSchema = z.object({
  canErase: z.boolean(),
  retentionDays: z.number().nullable(),
  records: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      recordName: z.string(),
      boardId: z.string(),
      boardName: z.string(),
      projectName: z.string().nullable(),
      parentDeleted: z.boolean(),
      deletedAt: z.string(),
      deletedBy: who,
      comments: z.number(),
      files: z.number(),
    }),
  ),
  boards: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      workspaceName: z.string(),
      projectName: z.string().nullable(),
      parentDeleted: z.boolean(),
      deletedAt: z.string(),
      deletedBy: who,
      records: z.number(),
    }),
  ),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      workspaceName: z.string(),
      deletedAt: z.string(),
      deletedBy: who,
      boards: z.number(),
    }),
  ),
});
export type TrashState = z.infer<typeof trashStateSchema>;
