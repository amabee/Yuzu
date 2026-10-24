import type { DatabaseTransaction } from "@yuzu/database";
import { createNotifications } from "./notification-events";
import { markChildrenChanged, lockTaskRoot } from "./task-hierarchy";
import { SetupError } from "./setup/security";
export async function finalizeProposal(
  tx: DatabaseTransaction,
  proposal: {
    id: string;
    boardId: string;
    taskId: string | null;
    parentTaskId: string | null;
    authorId: string;
  },
  actorId: string,
  reviewerId: string | null,
  status: "APPROVED" | "REJECTED" | "WITHDRAWN" | "STALE",
  reason?: string,
  applied?: { taskId: string; revision: number },
) {
  if (proposal.parentTaskId)
    await lockTaskRoot(tx, proposal.parentTaskId, proposal.boardId);
  const changed = await tx.boardProposal.updateMany({
    where: { id: proposal.id, status: "PENDING" },
    data: {
      status,
      reason: reason ?? null,
      decidedById: actorId,
      decidedAt: new Date(),
      ...(applied
        ? { taskId: applied.taskId, appliedRevision: applied.revision }
        : {}),
    },
  });
  if (!changed.count)
    throw new SetupError(
      409,
      "PROPOSAL_CLOSED",
      "This request has already been decided.",
    );
  if (proposal.parentTaskId)
    await markChildrenChanged(tx, proposal.parentTaskId);
  await createNotifications(tx, {
    recipientIds:
      status === "WITHDRAWN"
        ? reviewerId
          ? [reviewerId]
          : []
        : [proposal.authorId],
    actorId,
    boardId: proposal.boardId,
    taskId: applied?.taskId ?? proposal.taskId,
    proposalId: proposal.id,
    kind: "APPROVAL_DECISION",
    message:
      status === "APPROVED"
        ? "approved your request"
        : status === "REJECTED"
          ? "rejected your request"
          : status === "WITHDRAWN"
            ? "withdrew an approval request"
            : "closed your approval request because it needs to be resubmitted",
    eventKey: `proposal:${proposal.id}:decision`,
  });
  await tx.boardEvent.create({
    data: {
      boardId: proposal.boardId,
      actorId,
      action: `${status.charAt(0) + status.slice(1).toLowerCase()} task approval`,
      subjectId: proposal.id,
      before: { status: "PENDING" },
      after: { status, reason: reason ?? null },
    },
  });
  return {
    boardId: proposal.boardId,
    proposalId: proposal.id,
    status,
    taskId: applied?.taskId ?? proposal.taskId,
    reason: reason ?? null,
  };
}
export async function invalidateChildProposals(
  tx: DatabaseTransaction,
  rootId: string,
  actorId: string,
  reason: string,
) {
  const pending = await tx.boardProposal.findMany({
    where: {
      status: "PENDING",
      OR: [{ parentTaskId: rootId }, { task: { parentId: rootId } }],
    },
    take: 201,
  });
  if (pending.length > 200)
    throw new SetupError(
      409,
      "SUBITEM_REQUESTS",
      "Resolve outstanding subitem requests before changing this breakdown.",
    );
  for (const proposal of pending)
    await finalizeProposal(tx, proposal, actorId, null, "STALE", reason);
}
