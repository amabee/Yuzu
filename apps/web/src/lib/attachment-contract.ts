import { z } from "zod";
import { recordId, personId } from "./id-contract";

export const attachmentTypes: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "docx",
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    "pptx",
  ],
};
export const attachmentName = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine(
    (name) => !/[\x00-\x1f\x7f/\\]/.test(name) && name !== "." && name !== "..",
    "Use a file name without paths or control characters.",
  );
export const attachmentListSchema = z.object({
  maxSizeBytes: z.number().int().positive(),
  allowedMimeTypes: z.array(z.string()),
  canUpload: z.boolean(),
  files: z.array(
    z.object({
      id: recordId,
      fileName: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number().int().positive(),
      uploadedById: personId,
      uploadedByName: z.string(),
      createdAt: z.string(),
      canRemove: z.boolean(),
    }),
  ),
});

export function formatFileSize(bytes: number) {
  if (bytes >= 1_000_000) return `${Number((bytes / 1_000_000).toFixed(1))} MB`;
  if (bytes >= 1000) return `${Number((bytes / 1000).toFixed(1))} KB`;
  return `${bytes} B`;
}
