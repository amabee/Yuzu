import { z } from "zod";
import { exportCsvSchema } from "./csv-export";
import { createTaskSchema } from "./board-contract";

export const transferSchema = z.object({
  id: z.string().uuid(),
  boardId: z.string().uuid(),
  kind: z.enum(["IMPORT", "EXPORT"]),
  name: z.string(),
  status: z.enum([
    "UPLOADING",
    "QUEUED",
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ]),
  total: z.number().int(),
  done: z.number().int(),
  chunkCount: z.number().int(),
  error: z.string().nullable(),
  filename: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  summary: z.record(z.string(), z.number().int()),
});
export type CsvTransfer = z.infer<typeof transferSchema>;
export const stagedRowSchema = z
  .object({
    row: z.number().int().min(2).max(25_001),
    input: createTaskSchema,
    allowDuplicate: z.boolean(),
    sourceId: z.string().uuid().optional(),
  })
  .strict();
export const transferCreateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().uuid(),
      kind: z.literal("IMPORT"),
      boardId: z.string().uuid(),
      name: z.string().min(1).max(255),
      total: z.number().int().min(1).max(25_000),
      chunkCount: z.number().int().min(1).max(25_000),
    })
    .strict(),
  z
    .object({
      id: z.string().uuid(),
      kind: z.literal("EXPORT"),
      input: exportCsvSchema,
    })
    .strict(),
]);
export const uploadChunkSchema = z
  .object({
    action: z.literal("chunk"),
    index: z.number().int().min(0).max(24_999),
    rows: z
      .array(
        z
          .object({
            row: z.number().int().min(2).max(25_001),
            token: z.string().max(2_000_000),
            allowDuplicate: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const transferActionSchema = z.union([
  uploadChunkSchema,
  z
    .object({ action: z.enum(["start", "retry", "dismiss", "cancel"]) })
    .strict(),
]);
export const activeTransfer = (status: string) =>
  ["UPLOADING", "QUEUED", "RUNNING"].includes(status);
