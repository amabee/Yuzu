import {
  getDatabase,
  type DatabaseTransaction,
  type Prisma,
} from "@yuzu/database";
import { eligibleReviewer, sameApprovalValue } from "@/lib/approval-rules";
import type {
  ApprovalPolicy,
  TaskMutationResult,
} from "@/lib/approval-contract";
import {
  STAGE_REQUEST_DAYS,
  type StageApprovalRule,
  type StageRequestView,
} from "@/lib/deal-contract";
import { submitProposal } from "./approval-policy";
import { finalizeProposal } from "./proposal-finalization";
import { SetupError } from "./setup/security";
import { isAdministrator } from "./team-access";

/**
 * Stage requests: a deal's stage move waiting for approval. A request keeps
 * the values its decision depends on; any accepted change to them, or to the
 * deal's stage, sends it back for resubmitting. One waits per deal at most
 * (a partial unique index backs this up).
 */
export const STAGE_DEPENDENCY_VERSION = 1;
const dependencyLabels = {
  amount: "amount",
  currency: "currency",
  assigneeIds: "owner",
  dueDate: "expected close date",
  customerCompanyId: "customer",
  customerContactId: "customer",
} as const;
type Stage = { id: string; name: string; category: string };
export type StageDependencies = {
  version: number;
  rule: StageApprovalRule;
  from: Stage;
  to: Stage;
  values: Record<string, unknown>;
};
type Snapshot = Record<string, unknown>;
type Waiting = Prisma.BoardProposalGetPayload<object>;
const stageOf = ({ id, name, category }: Stage) => ({ id, name, category });

export const dependenciesOf = (
  rule: StageApprovalRule,
  from: Stage,
  to: Stage,
  snapshot: Snapshot,
): StageDependencies => ({
  version: STAGE_DEPENDENCY_VERSION,
  rule,
  from: stageOf(from),
  to: stageOf(to),
  values: Object.fromEntries(
    Object.keys(dependencyLabels).map((key) => [key, snapshot[key] ?? null]),
  ),
});

/** Why a waiting request no longer fits its deal, or null if it still does. */
export function changedDependency(
  dependencies: StageDependencies,
  snapshot: Snapshot,
) {
  if (snapshot.stageId !== dependencies.from.id)
    return "The deal moved to another stage after the request was sent.";
  for (const [key, label] of Object.entries(dependencyLabels))
    if (!sameApprovalValue(dependencies.values[key], snapshot[key] ?? null))
      return `The ${label} changed after the request was sent.`;
  return null;
}

/** Locks the pipeline row: stage requests, decisions and stage
 *  configuration take turns. Returns its stage approval rule. */
export async function lockPipelineRow(
  tx: DatabaseTransaction,
  boardId: string,
) {
  const rows = await tx.$queryRaw<{ stageApproval: StageApprovalRule }[]>`
    SELECT "stageApproval" FROM "Pipeline" WHERE "boardId" = ${boardId} FOR UPDATE`;
  return rows[0]?.stageApproval ?? null;
}

export const pendingStageRequest = (tx: DatabaseTransaction, taskId: string) =>
  tx.boardProposal.findFirst({
    where: { taskId, kind: "DEAL_STAGE", status: "PENDING" },
  });

/** Requests show to their requester, the pipeline's managers and approvers,
 *  and administrators. */
export const seesStageRequests =
  (
    viewer: { id: string; role: string },
    canManage: boolean,
    policy: ApprovalPolicy,
  ) =>
  (authorId: string) =>
    isAdministrator(viewer.role) ||
    canManage ||
    authorId === viewer.id ||
    policy.primaryApproverId === viewer.id ||
    policy.backupApproverId === viewer.id;

export const stageRequestPending = (visible: boolean) =>
  new SetupError(
    409,
    "STAGE_REQUEST_PENDING",
    visible
      ? "This deal already has a stage request waiting. Open the deal to see where it stands."
      : "A stage change is already pending for this deal.",
  );

const uniqueViolation = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === "P2002";

export async function requestStageChange(
  tx: DatabaseTransaction,
  args: {
    boardId: string;
    taskId: string;
    authorId: string;
    requestKey: string;
    requestDigest: string;
    changes: Record<string, unknown>;
    snapshot: Snapshot;
    policy: ApprovalPolicy;
    eligible: Set<string>;
    sourceRevision: number;
    rule: StageApprovalRule;
    from: Stage;
    to: Stage;
  },
): Promise<TaskMutationResult> {
  try {
    return await submitProposal(tx, {
      boardId: args.boardId,
      taskId: args.taskId,
      authorId: args.authorId,
      operation: "UPDATE",
      requestKey: args.requestKey,
      requestDigest: args.requestDigest,
      changes: args.changes,
      baseline: args.snapshot,
      policy: args.policy,
      eligible: args.eligible,
      sourceRevision: args.sourceRevision,
      stage: {
        dependencies: dependenciesOf(
          args.rule,
          args.from,
          args.to,
          args.snapshot,
        ),
        expiresAt: new Date(Date.now() + STAGE_REQUEST_DAYS * 86_400_000),
      },
    });
  } catch (error) {
    // Someone else's request won a race for this deal.
    if (uniqueViolation(error)) throw stageRequestPending(true);
    throw error;
  }
}

/**
 * After an accepted write to a pipeline deal: archiving closes its waiting
 * request, and changing what the request depends on sends it back.
 */
export async function reconcileStageRequest(
  tx: DatabaseTransaction,
  taskId: string,
  snapshot: Snapshot,
  actorId: string,
  action: string,
  /** The request being applied right now. */
  applying?: string,
) {
  const waiting = await pendingStageRequest(tx, taskId);
  if (!waiting || waiting.id === applying) return;
  if (action === "archive")
    return finalizeProposal(
      tx,
      waiting,
      actorId,
      null,
      "INVALIDATED",
      "The deal was archived.",
    );
  const why = changedDependency(
    waiting.dependencies as StageDependencies,
    snapshot,
  );
  if (why) await finalizeProposal(tx, waiting, actorId, null, "STALE", why);
}

/** Who a request that closes by itself appears to come from. */
async function closer(tx: DatabaseTransaction, request: Waiting) {
  const policy = await tx.boardApprovalPolicy.findUnique({
    where: { boardId: request.boardId },
    select: { primaryApproverId: true, backupApproverId: true },
  });
  return (
    [policy?.primaryApproverId, policy?.backupApproverId].find(
      (id) => id && id !== request.authorId,
    ) ?? request.authorId
  );
}

/** Expires overdue stage requests, oldest first, in bounded batches. */
export async function expireStageRequests(
  tx: DatabaseTransaction,
  where: Prisma.BoardProposalWhereInput = {},
  limit = 200,
) {
  const due = await tx.boardProposal.findMany({
    where: {
      ...where,
      kind: "DEAL_STAGE",
      status: "PENDING",
      expiresAt: { lte: new Date() },
    },
    orderBy: { expiresAt: "asc" },
    take: limit,
  });
  for (const request of due)
    await finalizeProposal(
      tx,
      request,
      await closer(tx, request),
      null,
      "EXPIRED",
      `Nobody decided it within ${STAGE_REQUEST_DAYS} days.`,
      undefined,
      { decided: false },
    );
  return due.length;
}
/** The background sweep; reads also expire what they show. */
export async function expireDueStageRequests() {
  return getDatabase().$transaction((tx) => expireStageRequests(tx));
}

/** Closes waiting stage requests that can no longer be decided. */
export async function invalidateStageRequests(
  tx: DatabaseTransaction,
  where: Prisma.BoardProposalWhereInput,
  actorId: string,
  reason: string,
) {
  const waiting = await tx.boardProposal.findMany({
    where: { ...where, kind: "DEAL_STAGE", status: "PENDING" },
    orderBy: { id: "asc" },
    take: 201,
  });
  for (const request of waiting.slice(0, 200))
    await finalizeProposal(
      tx,
      request,
      actorId,
      null,
      "INVALIDATED",
      reason,
      undefined,
      { decided: false },
    );
  // Beyond a batch, close the rest quietly; decisions recheck anyway.
  if (waiting.length > 200)
    await tx.boardProposal.updateMany({
      where: { ...where, kind: "DEAL_STAGE", status: "PENDING" },
      data: { status: "INVALIDATED", reason, decidedAt: new Date() },
    });
}

/** Waiting stage requests for some deals, as each viewer may see them. */
export async function stageRequestViews(
  tx: DatabaseTransaction,
  viewer: { id: string; role: string },
  canManage: boolean,
  policy: ApprovalPolicy,
  people: { id: string; name: string }[],
  taskIds: string[],
) {
  const views = new Map<string, NonNullable<StageRequestView>>();
  if (!taskIds.length) return views;
  const requests = await tx.boardProposal.findMany({
    where: { taskId: { in: taskIds }, kind: "DEAL_STAGE", status: "PENDING" },
    include: { author: { select: { name: true } } },
  });
  const sees = seesStageRequests(viewer, canManage, policy);
  const eligible = new Set(people.map((person) => person.id));
  for (const request of requests) {
    if (!sees(request.authorId)) {
      views.set(request.taskId!, { visible: false });
      continue;
    }
    const dependencies = request.dependencies as StageDependencies;
    const changes = request.changes as { stageReason?: string };
    const reviewerId = eligibleReviewer(policy, request.authorId, eligible);
    views.set(request.taskId!, {
      visible: true,
      id: request.id,
      fromStageId: dependencies.from.id,
      toStageId: dependencies.to.id,
      authorId: request.authorId,
      authorName: request.author.name,
      reviewerName:
        people.find((person) => person.id === reviewerId)?.name ?? null,
      note: changes.stageReason ?? null,
      createdAt: request.createdAt.toISOString(),
      expiresAt: request.expiresAt!.toISOString(),
      canDecide: reviewerId === viewer.id && request.authorId !== viewer.id,
      canWithdraw: request.authorId === viewer.id,
      canCancel: canManage && request.authorId !== viewer.id,
    });
  }
  return views;
}
