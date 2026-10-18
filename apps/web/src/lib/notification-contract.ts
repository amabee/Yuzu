import { z } from "zod";
import { recordId } from "./id-contract";
export const notificationSchema = z.object({
  id: recordId,
  kind: z.enum([
    "ASSIGNMENT",
    "APPROVAL_REQUEST",
    "APPROVAL_DECISION",
    "MENTION",
  ]),
  message: z.string(),
  actorName: z.string(),
  name: z.string(),
  boardName: z.string(),
  projectName: z.string().nullable(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});
export const notificationInboxSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
  nextCursor: recordId.nullable(),
});
export type NotificationInbox = z.infer<typeof notificationInboxSchema>;
export const notificationActionSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("read"), id: recordId, read: z.boolean() })
    .strict(),
  z.object({ action: z.literal("read-all"), throughId: recordId }).strict(),
  z.object({ action: z.literal("open"), id: recordId }).strict(),
]);
