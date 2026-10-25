import type { DatabaseTransaction, Prisma } from "@yuzu/database";
import {
  finalizeProposal,
  type ProposalOutcome,
} from "./proposal-finalization";
import { lockTaskRoot, checkSubitemCapacity } from "./task-hierarchy";
import { subitemCreateSchema, prepareSubitemParent } from "./subitem-service";
import { getDatabase } from "@yuzu/database";
import { z } from "zod";
import {
  approvalPolicySchema,
  configureApprovalSchema,
  proposalDecisionSchema,
  proposalStatusSchema,
  type ApprovalQueue,
} from "@/lib/approval-contract";
import {
  approvalConflicts,
  compatiblePolicy,
  eligibleReviewer,
  stableJson,
} from "@/lib/approval-rules";
import {
  recordId,
  createTaskSchema,
  updateTaskSchema,
  fieldOptions,
} from "@/lib/board-contract";
import {
  boardRecord,
  access,
  serial,
  eligiblePeople,
  loadTask,
  canEdit,
  snapshot,
  createTaskRecord,
  applyTaskRecord,
  validateCore,
  validateValues,
} from "./board-service";
import { readApprovalPolicy } from "./approval-policy";
import {
  changedDependency,
  expireStageRequests,
  lockPipelineRow,
  type StageDependencies,
} from "./stage-requests";
import {
  stageNeedsApproval,
  type StageApprovalRule,
  type StageCategory,
} from "@/lib/deal-contract";
import { builtinForColumn } from "@/lib/record-types";
import { requireIdentity, isAdministrator, boardScope } from "./team-access";
import { SetupError } from "./setup/security";
import { createNotifications } from "./notification-events";
const missing = () =>
  new SetupError(
    404,
    "NOT_FOUND",
    "This approval request is not available to you.",
  );
export async function configureApprovals(input: unknown, headers: Headers) {
  const body = configureApprovalSchema.parse(input);
  const { user } = await requireIdentity(headers);
  return serial(async (tx) => {
    const context = await access(tx, user.id, body.boardId, true);
    if (!context.canManage)
      throw new SetupError(
        403,
        "FORBIDDEN",
        "Only a board manager or administrator can configure approvals.",
      );
    const before = await readApprovalPolicy(tx, context.board);
    if (before.version !== body.version)
      throw new SetupError(
        409,
        "POLICY_CHANGED",
        "Approval settings changed. Reopen board details before saving.",
      );
    const eligible = new Set(
      (await eligiblePeople(tx, context.board)).map((person) => person.id),
    );
    if (
      [body.primaryApproverId, body.backupApproverId].some(
        (id) => id && !eligible.has(id),
      )
    )
      throw new SetupError(
        422,
        "INVALID_APPROVER",
        "Choose approvers with current access to this workspace.",
      );
    if (body.enabled && !body.primaryApproverId)
      throw new SetupError(
        422,
        "APPROVER_REQUIRED",
        "Choose a primary approver before enabling approval mode.",
      );
    const record = boardRecord(context.board).config;
    const usable = (id: string) => {
      const field = context.board.columns.find((item) => item.id === id);
      if (!field) return false;
      const builtin = builtinForColumn(field.key);
      return !builtin || record.builtins[builtin].on;
    };
    if (body.protectedFieldIds.some((id) => !usable(id)))
      throw new SetupError(
        422,
        "INVALID_FIELD",
        "Choose active fields from this board.",
      );
    const { boardId, version, ...settings } = body;
    settings.protectedFieldIds.sort();
    if (
      stableJson({
        ...before,
        version: 0,
        protectedFieldIds: [...before.protectedFieldIds].sort(),
      }) === stableJson({ ...settings, version: 0 })
    )
      return { boardId, policyVersion: version, invalidated: 0 };
    const policy = approvalPolicySchema.parse(
      await tx.boardApprovalPolicy.upsert({
        where: { boardId },
        create: { boardId, ...settings, version: version + 1 },
        update: { ...settings, version: version + 1 },
      }),
    );
    const pending = await tx.boardProposal.findMany({
      where: { boardId, status: "PENDING" },
      select: {
        id: true,
        parentTaskId: true,
        operation: true,
        kind: true,
        authorId: true,
        taskId: true,
        changes: true,
        policySnapshot: true,
      },
    });
    // Stage requests follow the pipeline's stage rule, which this doesn't
    // change: they only lapse when approvals are turned off.
    const invalid = pending
      .filter((proposal) =>
        proposal.kind === "DEAL_STAGE"
          ? !policy.enabled
          : !compatiblePolicy(
              approvalPolicySchema.parse(proposal.policySnapshot),
              policy,
              proposal.operation,
              proposal.changes as Record<string, unknown>,
              context.board.columns,
            ),
      )
      .map((proposal) => proposal.id);
    if (invalid.length)
      await tx.boardProposal.updateMany({
        where: { id: { in: invalid }, parentTaskId: null, status: "PENDING" },
        data: {
          status: "STALE",
          reason:
            "Approval requirements changed. Submit this request again under the current policy.",
          decidedAt: new Date(),
          decidedById: user.id,
        },
      });
    for (const proposal of pending) {
      if (invalid.includes(proposal.id)) {
        if (proposal.parentTaskId) {
          await finalizeProposal(
            tx,
            { ...proposal, boardId },
            user.id,
            null,
            "STALE",
            "Approval requirements changed. Submit this request again under the current policy.",
          );
          continue;
        }
        await createNotifications(tx, {
          recipientIds: [proposal.authorId],
          actorId: user.id,
          boardId,
          taskId: proposal.taskId,
          proposalId: proposal.id,
          kind: "APPROVAL_DECISION",
          message:
            "closed your approval request because the approval settings changed",
          eventKey: `proposal:${proposal.id}:decision`,
        });
      } else {
        const reviewer = eligibleReviewer(policy, proposal.authorId, eligible);
        const previous = eligibleReviewer(before, proposal.authorId, eligible);
        if (reviewer && reviewer !== previous)
          await createNotifications(tx, {
            recipientIds: [reviewer],
            actorId: user.id,
            boardId,
            taskId: proposal.taskId,
            proposalId: proposal.id,
            kind: "APPROVAL_REQUEST",
            message: "assigned you an approval request",
            eventKey: `proposal:${proposal.id}:review:${policy.version}`,
          });
      }
    }
    await tx.boardEvent.create({
      data: {
        boardId,
        actorId: user.id,
        action: "Changed approval policy",
        before,
        after: { ...policy, invalidatedRequests: invalid.length },
      },
    });
    return {
      boardId,
      policyVersion: policy.version,
      invalidated: invalid.length,
      affectedUserIds: [
        before.primaryApproverId,
        before.backupApproverId,
      ].filter((id): id is string => Boolean(id)),
    };
  });
}
export async function decideApproval(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return serial((tx) => decideApprovalInTransaction(tx, input, user.id, true));
}
export async function decideApprovalInTransaction(
  tx: DatabaseTransaction,
  input: unknown,
  userId: string,
  includeSubitems = false,
) {
  const body = proposalDecisionSchema.parse(input);
  const user = { id: userId };
  const proposal = await tx.boardProposal.findUnique({
    where: { id: body.proposalId },
    include: { task: { select: { parentId: true } } },
  });
  if (
    !proposal ||
    (!includeSubitems && (proposal.parentTaskId || proposal.task?.parentId))
  )
    throw missing();
  if (proposal.kind === "DEAL_STAGE")
    return decideStageRequest(tx, proposal, body, userId);
  if (body.action === "cancel")
    throw new SetupError(
      422,
      "CANCEL_UNAVAILABLE",
      "Only stage requests can be cancelled. Ask the author to withdraw this one.",
    );
  if (proposal.parentTaskId)
    await lockTaskRoot(tx, proposal.parentTaskId, proposal.boardId);
  const context = await access(tx, user.id, proposal.boardId, true);
  const policy = await readApprovalPolicy(tx, context.board);
  const people = new Set(
    (await eligiblePeople(tx, context.board)).map((person) => person.id),
  );
  const reviewerId = eligibleReviewer(policy, proposal.authorId, people);
  if (
    body.action === "withdraw"
      ? proposal.authorId !== user.id
      : user.id === proposal.authorId || reviewerId !== user.id
  )
    throw new SetupError(
      403,
      "FORBIDDEN",
      body.action === "withdraw"
        ? "Only the author can withdraw this request."
        : "Only the designated reviewer can decide this request. Self-approval is not allowed.",
    );
  if (proposal.status !== "PENDING")
    throw new SetupError(
      409,
      "PROPOSAL_CLOSED",
      "This request has already been decided.",
    );
  const finish = (
    status: "APPROVED" | "REJECTED" | "WITHDRAWN" | "STALE",
    reason?: string,
    applied?: { taskId: string; revision: number },
  ) =>
    finalizeProposal(
      tx,
      proposal,
      user.id,
      reviewerId,
      status,
      reason,
      applied,
    );
  if (body.action === "withdraw") return finish("WITHDRAWN");
  let authorContext: Awaited<ReturnType<typeof access>>;
  try {
    authorContext = await access(tx, proposal.authorId, proposal.boardId);
  } catch (error) {
    if (error instanceof SetupError && [401, 403, 404].includes(error.status))
      return finish(
        "STALE",
        "The author no longer has access to this board. An authorized person must resubmit.",
      );
    throw error;
  }
  const task = proposal.taskId
    ? await loadTask(tx, proposal.taskId, includeSubitems)
    : null;
  if (
    proposal.operation !== "CREATE" &&
    (!task ||
      task.archivedAt ||
      task.deletedAt ||
      !canEdit(task, authorContext))
  )
    return finish(
      "STALE",
      "The task is unavailable or the author no longer has editing access. Resubmit with current permissions.",
    );
  if (body.action === "reject") return finish("REJECTED", body.reason);
  const proposed = proposal.changes as Record<string, unknown>;
  if (
    !compatiblePolicy(
      approvalPolicySchema.parse(proposal.policySnapshot),
      policy,
      proposal.operation,
      proposed,
      context.board.columns,
    )
  )
    return finish(
      "STALE",
      "Approval requirements changed. Submit the request again under the current policy.",
    );
  if (
    task &&
    approvalConflicts(
      proposal.baseline as Record<string, unknown>,
      snapshot(task),
      proposed,
      proposal.operation,
    ).length
  )
    return finish(
      "STALE",
      "One or more proposed fields changed after submission. Review the latest task and resubmit.",
    );
  // Validate before writing. Only validation failures become stale; storage errors roll back.
  let creation: z.infer<typeof createTaskSchema> | undefined;
  let changes: z.infer<typeof updateTaskSchema>["changes"] | undefined;
  try {
    if (proposal.operation === "CREATE") {
      if (proposal.parentTaskId) {
        const child = subitemCreateSchema.parse(proposed);
        if (child.parentId !== proposal.parentTaskId) throw missing();
        await prepareSubitemParent(
          tx,
          proposal.authorId,
          child.boardId,
          child.parentId,
        );
        await checkSubitemCapacity(tx, child.parentId, true);
        creation = child;
      } else creation = createTaskSchema.parse(proposed);
      if (creation.boardId !== proposal.boardId) throw missing();
      validateCore(creation, context.board, people);
      validateValues(creation.fieldValues, context.board, people);
    }
    if (proposal.operation === "UPDATE") {
      changes = updateTaskSchema.parse({
        taskId: task!.id,
        revision: task!.revision,
        changes: proposed,
      }).changes;
      validateCore(changes, context.board, people);
      validateValues(changes.fieldValues, context.board, people);
    }
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      (error instanceof SetupError && [403, 404, 422].includes(error.status))
    )
      return finish(
        "STALE",
        "Fields, options or eligible people changed. Review and resubmit the request.",
      );
    throw error;
  }
  const applied = creation
    ? await createTaskRecord(
        tx,
        authorContext,
        people,
        creation,
        proposal.authorId,
        proposal.requestDigest,
        user.id,
        "Approved task creation",
        undefined,
        proposal.parentTaskId ?? undefined,
      )
    : await applyTaskRecord(
        tx,
        task!,
        authorContext,
        people,
        user.id,
        proposal.operation === "ARCHIVE" ? "archive" : "update",
        changes,
        undefined,
        proposal.operation === "ARCHIVE"
          ? "Approved task archive"
          : "Approved task change",
        undefined,
        (proposal.baseline as { childrenRevision?: number }).childrenRevision,
      );
  return finish("APPROVED", undefined, applied);
}
/**
 * Decides a stage request under the pipeline lock: the requester withdraws,
 * a manager cancels with a reason, the current approver approves or
 * rejects. Approval rechecks expiry, access, the stage rule and every value
 * the request depends on, then makes the move atomically.
 */
async function decideStageRequest(
  tx: DatabaseTransaction,
  proposal: Prisma.BoardProposalGetPayload<object>,
  body: z.infer<typeof proposalDecisionSchema>,
  userId: string,
) {
  await lockPipelineRow(tx, proposal.boardId);
  const context = await access(tx, userId, proposal.boardId, true);
  const policy = await readApprovalPolicy(tx, context.board);
  const people = new Set(
    (await eligiblePeople(tx, context.board)).map((person) => person.id),
  );
  const reviewerId = eligibleReviewer(policy, proposal.authorId, people);
  const allowed =
    body.action === "withdraw"
      ? proposal.authorId === userId
      : body.action === "cancel"
        ? context.canManage && proposal.authorId !== userId
        : reviewerId === userId && proposal.authorId !== userId;
  if (!allowed)
    throw new SetupError(
      403,
      "FORBIDDEN",
      body.action === "withdraw"
        ? "Only the person who asked can withdraw this request."
        : body.action === "cancel"
          ? "Only this pipeline's managers can cancel someone else's request."
          : "Only the designated approver can decide this request. Self-approval is not allowed.",
    );
  if (proposal.status !== "PENDING")
    throw new SetupError(
      409,
      "PROPOSAL_CLOSED",
      "This request has already been decided.",
    );
  const finish = (
    status: ProposalOutcome,
    reason?: string,
    applied?: { taskId: string; revision: number },
    decided = true,
  ) =>
    finalizeProposal(
      tx,
      proposal,
      userId,
      reviewerId,
      status,
      reason,
      applied,
      { decided },
    );
  if (body.action === "withdraw") return finish("WITHDRAWN");
  if (body.action === "cancel") return finish("CANCELLED", body.reason);
  if (proposal.expiresAt && proposal.expiresAt <= new Date())
    return finish(
      "EXPIRED",
      "Nobody decided it in time. Send a new request if it's still needed.",
      undefined,
      false,
    );
  const author = await tx.user.findUnique({
    where: { id: proposal.authorId },
    select: { deactivatedAt: true },
  });
  if (!author || author.deactivatedAt)
    return finish("INVALIDATED", "The person who asked was deactivated.");
  let authorContext: Awaited<ReturnType<typeof access>>;
  try {
    authorContext = await access(tx, proposal.authorId, proposal.boardId);
  } catch (error) {
    if (error instanceof SetupError && [401, 403, 404].includes(error.status))
      return finish(
        "STALE",
        "The person who asked no longer has access to this pipeline.",
      );
    throw error;
  }
  const task = proposal.taskId ? await loadTask(tx, proposal.taskId) : null;
  if (!task || task.deletedAt)
    return finish("INVALIDATED", "The deal was deleted.");
  if (task.archivedAt) return finish("INVALIDATED", "The deal was archived.");
  if (!canEdit(task, authorContext))
    return finish(
      "STALE",
      "The person who asked can no longer edit this deal.",
    );
  if (body.action === "reject") return finish("REJECTED", body.reason);
  const dependencies = proposal.dependencies as StageDependencies;
  const pipeline = await tx.pipeline.findUnique({
    where: { boardId: proposal.boardId },
    include: { stages: true },
  });
  const from = pipeline?.stages.find(
    (stage) => stage.id === dependencies.from.id,
  );
  const to = pipeline?.stages.find((stage) => stage.id === dependencies.to.id);
  if (
    !pipeline ||
    !from ||
    !to ||
    !policy.enabled ||
    from.category !== dependencies.from.category ||
    to.category !== dependencies.to.category ||
    !stageNeedsApproval(
      pipeline.stageApproval as StageApprovalRule,
      from.category as StageCategory,
      to.category as StageCategory,
    )
  )
    return finish(
      "STALE",
      "The pipeline's stages or approval rules changed. Move the deal again under the current rules.",
    );
  const changed = changedDependency(dependencies, snapshot(task));
  if (changed) return finish("STALE", changed);
  const { changes } = updateTaskSchema.parse({
    taskId: task.id,
    revision: task.revision,
    changes: proposal.changes,
  });
  const applied = await applyTaskRecord(
    tx,
    task,
    authorContext,
    people,
    userId,
    "update",
    changes,
    undefined,
    "Approved stage change",
    undefined,
    undefined,
    { proposalId: proposal.id, requestedById: proposal.authorId },
  );
  return finish("APPROVED", undefined, applied);
}

export async function approvalQueue(
  headers: Headers,
  filter = "PENDING",
  cursor?: string,
  requestId?: string,
): Promise<ApprovalQueue> {
  const { user } = await requireIdentity(headers);
  const status =
    filter === "ALL" ? undefined : proposalStatusSchema.parse(filter);
  return getDatabase().$transaction(async (tx) => {
    // What the queue shows is current: overdue stage requests expire first.
    await expireStageRequests(tx, { board: boardScope(user) });
    const rows = await tx.boardProposal.findMany({
      where: {
        ...(requestId ? { id: recordId.parse(requestId) } : {}),
        board: boardScope(user),
        ...(isAdministrator(user.role)
          ? {}
          : {
              OR: [
                { authorId: user.id },
                { board: { managers: { some: { userId: user.id } } } },
                {
                  board: {
                    approvalPolicy: {
                      is: {
                        OR: [
                          { primaryApproverId: user.id },
                          { backupApproverId: user.id },
                        ],
                      },
                    },
                  },
                },
              ],
            }),
        ...(status ? { status } : {}),
        ...(cursor ? { id: { lt: recordId.parse(cursor) } } : {}),
      },
      orderBy: { id: "desc" },
      take: 51,
      include: {
        author: { select: { name: true } },
        decidedBy: { select: { name: true } },
        task: { select: { name: true, parent: { select: { name: true } } } },
        parentTask: { select: { name: true } },
        board: {
          include: {
            columns: true,
            groups: { orderBy: { position: "asc" } },
            managers: { select: { userId: true } },
          },
        },
      },
    });
    const contexts = new Map<
      string,
      {
        policy: Awaited<ReturnType<typeof readApprovalPolicy>>;
        people: Awaited<ReturnType<typeof eligiblePeople>>;
      }
    >();
    const proposals: ApprovalQueue["proposals"] = [];
    for (const proposal of rows.slice(0, 50)) {
      let data = contexts.get(proposal.boardId);
      if (!data) {
        data = {
          policy: await readApprovalPolicy(tx, proposal.board),
          people: await eligiblePeople(tx, proposal.board),
        };
        contexts.set(proposal.boardId, data);
      }
      const reviewerId = eligibleReviewer(
        data.policy,
        proposal.authorId,
        new Set(data.people.map((person) => person.id)),
      );
      const changes = proposal.changes as Record<string, unknown>;
      const baseline = proposal.baseline as Record<string, unknown>;
      proposals.push({
        id: proposal.id,
        boardId: proposal.boardId,
        boardName: proposal.board.name,
        kind: proposal.kind,
        stage:
          proposal.kind === "DEAL_STAGE"
            ? {
                from: (proposal.dependencies as StageDependencies).from.name,
                to: (proposal.dependencies as StageDependencies).to.name,
              }
            : null,
        taskId: proposal.taskId,
        operation: proposal.operation,
        status: proposal.status,
        authorId: proposal.authorId,
        authorName: proposal.author.name,
        name: `${proposal.task?.name ?? String(changes.name ?? baseline.name ?? "Task request")}${proposal.parentTask || proposal.task?.parent ? ` · Subitem of ${proposal.parentTask?.name ?? proposal.task?.parent?.name}` : ""}`,
        createdAt: proposal.createdAt.toISOString(),
        changes,
        baseline,
        fields: proposal.board.columns.map((field) => ({
          id: field.id,
          key: field.key,
          type: field.type,
          name: field.name,
          options: fieldOptions(field.config),
        })),
        people: data.people.map(({ id, name }) => ({ id, name })),
        groups: proposal.board.groups.map(({ id, name }) => ({ id, name })),
        reviewerId,
        reviewerName:
          data.people.find((person) => person.id === reviewerId)?.name ?? null,
        canDecide:
          proposal.status === "PENDING" &&
          reviewerId === user.id &&
          proposal.authorId !== user.id,
        canWithdraw:
          proposal.status === "PENDING" && proposal.authorId === user.id,
        canCancel:
          proposal.kind === "DEAL_STAGE" &&
          proposal.status === "PENDING" &&
          proposal.authorId !== user.id &&
          (isAdministrator(user.role) ||
            proposal.board.managers.some(
              (manager) => manager.userId === user.id,
            )),
        reason: proposal.reason,
        decidedByName: proposal.decidedBy?.name ?? null,
        decidedAt: proposal.decidedAt?.toISOString() ?? null,
      });
    }
    return {
      currentUserId: user.id,
      proposals,
      nextCursor: rows.length > 50 ? rows[49]!.id : null,
    };
  });
}
