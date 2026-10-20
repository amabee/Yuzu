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
        operation: true,
        authorId: true,
        taskId: true,
        changes: true,
        policySnapshot: true,
      },
    });
    const invalid = pending
      .filter(
        (proposal) =>
          !compatiblePolicy(
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
        where: { id: { in: invalid }, status: "PENDING" },
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
  const body = proposalDecisionSchema.parse(input);
  const { user } = await requireIdentity(headers);
  return serial(async (tx) => {
    const proposal = await tx.boardProposal.findUnique({
      where: { id: body.proposalId },
    });
    if (!proposal) throw missing();
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
    const finish = async (
      status: "APPROVED" | "REJECTED" | "WITHDRAWN" | "STALE",
      reason?: string,
      applied?: { taskId: string; revision: number },
    ) => {
      const changed = await tx.boardProposal.updateMany({
        where: { id: proposal.id, status: "PENDING" },
        data: {
          status,
          reason: reason ?? null,
          decidedById: user.id,
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
      await createNotifications(tx, {
        recipientIds:
          status === "WITHDRAWN"
            ? reviewerId
              ? [reviewerId]
              : []
            : [proposal.authorId],
        actorId: user.id,
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
          actorId: user.id,
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
    };
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
    const task = proposal.taskId ? await loadTask(tx, proposal.taskId) : null;
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
        creation = createTaskSchema.parse(proposed);
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
        (error instanceof SetupError && [404, 422].includes(error.status))
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
        );
    return finish("APPROVED", undefined, applied);
  });
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
        task: { select: { name: true } },
        board: {
          include: { columns: true, groups: { orderBy: { position: "asc" } } },
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
        taskId: proposal.taskId,
        operation: proposal.operation,
        status: proposal.status,
        authorId: proposal.authorId,
        authorName: proposal.author.name,
        name:
          proposal.task?.name ??
          String(changes.name ?? baseline.name ?? "Task request"),
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
