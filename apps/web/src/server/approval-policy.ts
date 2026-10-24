import { createRecordId, type DatabaseTransaction } from "@yuzu/database";
import {
  approvalPolicySchema,
  type ApprovalOperation,
  type ApprovalPolicy,
  type TaskMutationResult,
} from "@/lib/approval-contract";
import { eligibleReviewer } from "@/lib/approval-rules";
import { SetupError } from "./setup/security";
import { createNotifications } from "./notification-events";
export async function readApprovalPolicy(
  tx: DatabaseTransaction,
  board: { id: string; columns: { id: string; key: string }[] },
): Promise<ApprovalPolicy> {
  const policy = await tx.boardApprovalPolicy.findUnique({
    where: { boardId: board.id },
  });
  return approvalPolicySchema.parse(
    policy ?? {
      version: 0,
      enabled: false,
      requireCreation: false,
      requireChanges: true,
      requireArchive: false,
      protectedFieldIds: board.columns
        .filter((field) => field.key === "assignees")
        .map((field) => field.id),
      primaryApproverId: null,
      backupApproverId: null,
    },
  );
}
export async function existingProposal(
  tx: DatabaseTransaction,
  authorId: string,
  requestKey: string,
  requestDigest: string,
): Promise<TaskMutationResult | null> {
  const existing = await tx.boardProposal.findUnique({
    where: { authorId_requestKey: { authorId, requestKey } },
  });
  if (!existing) return null;
  if (existing.requestDigest !== requestDigest)
    throw new SetupError(
      409,
      "RETRY_CHANGED",
      "This submission key belongs to a different request. Submit again with a new key.",
    );
  if (existing.status === "PENDING")
    return {
      outcome: "PENDING_APPROVAL",
      proposalId: existing.id,
      taskId: existing.taskId,
      ...(existing.sourceRevision ? { revision: existing.sourceRevision } : {}),
    };
  if (
    existing.status === "APPROVED" &&
    existing.taskId &&
    existing.appliedRevision
  )
    return {
      outcome: "APPLIED",
      proposalId: existing.id,
      taskId: existing.taskId,
      revision: existing.appliedRevision,
    };
  throw new SetupError(
    409,
    "PROPOSAL_CLOSED",
    "This request is already closed. Submit your changes again with a new request.",
  );
}
export async function submitProposal(
  tx: DatabaseTransaction,
  args: {
    boardId: string;
    taskId?: string;
    parentTaskId?: string;
    authorId: string;
    operation: ApprovalOperation;
    requestKey: string;
    requestDigest: string;
    changes: Record<string, unknown>;
    baseline: Record<string, unknown>;
    policy: ApprovalPolicy;
    eligible: Set<string>;
    sourceRevision?: number;
  },
): Promise<TaskMutationResult> {
  const reviewer = eligibleReviewer(args.policy, args.authorId, args.eligible);
  if (!reviewer)
    throw new SetupError(
      409,
      "APPROVER_REQUIRED",
      "No other eligible approver can review this change. Ask a board manager to appoint a primary or backup approver.",
    );
  const proposal = await tx.boardProposal.create({
    data: {
      id: createRecordId(),
      boardId: args.boardId,
      taskId: args.taskId,
      parentTaskId: args.parentTaskId,
      authorId: args.authorId,
      operation: args.operation,
      requestKey: args.requestKey,
      requestDigest: args.requestDigest,
      changes: JSON.parse(JSON.stringify(args.changes)),
      baseline: JSON.parse(JSON.stringify(args.baseline)),
      policySnapshot: args.policy,
      policyVersion: args.policy.version,
      sourceRevision: args.sourceRevision,
    },
  });
  await createNotifications(tx, {
    recipientIds: [reviewer],
    actorId: args.authorId,
    boardId: args.boardId,
    taskId: args.taskId,
    proposalId: proposal.id,
    kind: "APPROVAL_REQUEST",
    message: "requested your approval",
    eventKey: `proposal:${proposal.id}:review:${args.policy.version}`,
  });
  await tx.boardEvent.create({
    data: {
      boardId: args.boardId,
      actorId: args.authorId,
      action: "Requested task approval",
      subjectId: proposal.id,
      after: { operation: args.operation, reviewerId: reviewer },
    },
  });
  return {
    outcome: "PENDING_APPROVAL",
    proposalId: proposal.id,
    taskId: args.taskId ?? null,
    ...(args.sourceRevision ? { revision: args.sourceRevision } : {}),
  };
}
