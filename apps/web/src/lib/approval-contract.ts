import { z } from "zod";
import { recordId, personId } from "./id-contract";
export const approvalPolicySchema = z.object({
  version: z.number().int().nonnegative(),
  enabled: z.boolean(),
  requireCreation: z.boolean(),
  requireChanges: z.boolean(),
  requireArchive: z.boolean(),
  protectedFieldIds: z
    .array(recordId)
    .max(100)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Choose each field once.",
    ),
  primaryApproverId: personId.nullable(),
  backupApproverId: personId.nullable(),
});
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;
export const configureApprovalSchema = approvalPolicySchema
  .extend({ boardId: recordId })
  .strict()
  .refine(
    (policy) =>
      !policy.backupApproverId ||
      policy.backupApproverId !== policy.primaryApproverId,
    "Choose a different backup approver.",
  );
export const operationSchema = z.enum(["CREATE", "UPDATE", "ARCHIVE"]);
export type ApprovalOperation = z.infer<typeof operationSchema>;
export const proposalStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "STALE",
]);
export const pendingApprovalSchema = z.object({
  id: recordId,
  taskId: recordId.nullable(),
  operation: operationSchema,
  authorId: personId,
  authorName: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;
const values = z.record(z.string(), z.unknown());
export const approvalQueueSchema = z.object({
  currentUserId: personId,
  proposals: z.array(
    pendingApprovalSchema.extend({
      boardId: recordId,
      boardName: z.string(),
      status: proposalStatusSchema,
      changes: values,
      baseline: values,
      fields: z.array(
        z.object({
          id: z.string(),
          key: z.string(),
          type: z.string(),
          name: z.string(),
          options: z.array(z.object({ id: z.string(), label: z.string() })),
        }),
      ),
      people: z.array(z.object({ id: personId, name: z.string() })),
      groups: z.array(z.object({ id: recordId, name: z.string() })),
      reviewerId: personId.nullable(),
      reviewerName: z.string().nullable(),
      canDecide: z.boolean(),
      canWithdraw: z.boolean(),
      reason: z.string().nullable(),
      decidedByName: z.string().nullable(),
      decidedAt: z.string().nullable(),
    }),
  ),
  nextCursor: recordId.nullable(),
});
export type ApprovalQueue = z.infer<typeof approvalQueueSchema>;
export const proposalDecisionSchema = z
  .object({
    proposalId: recordId,
    action: z.enum(["approve", "reject", "withdraw"]),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (body) => body.action !== "reject" || Boolean(body.reason),
    "Give a short reason for rejection.",
  );
export const taskMutationResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("APPLIED"),
    taskId: recordId,
    revision: z.number().int().positive(),
    proposalId: recordId.optional(),
  }),
  z.object({
    outcome: z.literal("PENDING_APPROVAL"),
    proposalId: recordId,
    taskId: recordId.nullable(),
    revision: z.number().int().positive().optional(),
  }),
]);
export type TaskMutationResult = z.infer<typeof taskMutationResultSchema>;
