import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRecordId, getDatabase } from "@yuzu/database";
import {
  createTaskInTransaction,
  mutateTaskInTransaction,
  serial,
} from "@/server/board-service";
import { decideApprovalInTransaction } from "@/server/approval-service";
import { changeStagesFor, createPipelineFor } from "@/server/pipeline-service";
import { dealLanesFor, dealRecordFor } from "@/server/deals-service";
import { deleteRecordInTransaction } from "@/server/trash-service";
import { expireStageRequests } from "@/server/stage-requests";

/** Stage-change approvals on CRM pipelines (slice 2b). */
const db = getDatabase();
const workspaceIds: string[] = [],
  userIds: string[] = [];
beforeAll(async () => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/yuzu_e2e")
    throw new Error("Refusing a non-test database.");
  const migrated = spawnSync("pnpm db:deploy", {
    shell: true,
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: process.env,
    stdio: "pipe",
  });
  if (migrated.status !== 0)
    throw new Error("Could not migrate the isolated stage request database.");
  await db.installationSettings.upsert({
    where: { id: "installation" },
    create: { setupState: "READY", currency: "PHP" },
    update: { setupState: "READY", maintenanceMode: false, currency: "PHP" },
  });
});
afterAll(async () => {
  // Only fixtures created by this file, and only yuzu_e2e. No dev-data reset.
  const boards = { board: { workspaceId: { in: workspaceIds } } };
  await db.notification.deleteMany({ where: boards });
  await db.boardProposal.deleteMany({ where: boards });
  await db.task.deleteMany({ where: boards });
  await db.board.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

/** A pipeline with approvals on: admin manages it, approver reviews. */
async function fixture(approver: "admin" | "approver" = "admin") {
  const people = await Promise.all(
    ["admin", "seller", "approver", "viewer"].map((name) =>
      db.user.create({
        data: {
          name,
          email: `${createRecordId()}@stages.test`,
          emailVerified: true,
          role: name === "admin" ? "ADMIN" : "MEMBER",
        },
      }),
    ),
  );
  const [admin, seller, reviewer, viewer] = people;
  userIds.push(...people.map((person) => person.id));
  const workspace = await db.workspace.create({
    data: {
      name: "Stage requests",
      createdById: admin.id,
      members: {
        create: [seller, reviewer, viewer].map((person) => ({
          userId: person.id,
        })),
      },
    },
  });
  workspaceIds.push(workspace.id);
  const { boardId } = await createPipelineFor(admin, {
    workspaceId: workspace.id,
    name: "New business",
  });
  const stages = await db.pipelineStage.findMany({ where: { boardId } });
  const stage = (key: string) => stages.find((item) => item.key === key)!.id;
  await db.boardApprovalPolicy.create({
    data: {
      boardId,
      enabled: true,
      requireChanges: true,
      protectedFieldIds: [],
      primaryApproverId: approver === "admin" ? admin.id : reviewer.id,
    },
  });
  return { admin, seller, reviewer, viewer, workspace, boardId, stage };
}
const create = (
  boardId: string,
  userId: string,
  values: Record<string, unknown> = {},
) =>
  serial((tx) =>
    createTaskInTransaction(
      tx,
      { boardId, createKey: createRecordId(), name: "Acme renewal", ...values },
      userId,
    ),
  );
const applied = (result: Awaited<ReturnType<typeof create>>) => {
  if (result.outcome !== "APPLIED")
    throw new Error("Expected a direct change.");
  return result.taskId;
};
const revision = async (id: string) =>
  (await db.task.findUniqueOrThrow({ where: { id } })).revision;
const update = async (
  id: string,
  changes: Record<string, unknown>,
  userId: string,
) =>
  serial(async (tx) =>
    mutateTaskInTransaction(
      tx,
      "update",
      // Each save is a new request, as the app sends it.
      {
        taskId: id,
        revision: await revision(id),
        changes,
        requestKey: createRecordId(),
      },
      userId,
    ),
  );
/** Lets someone outside the request's circle edit a deal. */
const grantEditor = (taskId: string, userId: string, grantedById: string) =>
  db.taskEditorGrant.create({ data: { taskId, userId, grantedById } });
const decide = (
  proposalId: string,
  action: "approve" | "reject" | "withdraw" | "cancel",
  userId: string,
  reason?: string,
) =>
  serial((tx) =>
    decideApprovalInTransaction(
      tx,
      { proposalId, action, ...(reason ? { reason } : {}) },
      userId,
    ),
  );
const waiting = (taskId: string) =>
  db.boardProposal.findFirstOrThrow({
    where: { taskId, kind: "DEAL_STAGE", status: "PENDING" },
  });
const stageOf = async (id: string) =>
  (await db.dealProfile.findUniqueOrThrow({ where: { recordId: id } })).stageId;
describe("Stage requests", () => {
  it("wait for approval to close, while open moves stay direct", async () => {
    const f = await fixture();
    const id = applied(await create(f.boardId, f.seller.id, { amount: 500 }));
    // Between open stages: a direct move under the default rule.
    expect(
      (await update(id, { stageId: f.stage("qualified") }, f.seller.id))
        .outcome,
    ).toBe("APPLIED");
    // Closing: a request, and the deal stays where it is.
    const asked = await update(
      id,
      { stageId: f.stage("won"), stageReason: "PO signed" },
      f.seller.id,
    );
    expect(asked.outcome).toBe("PENDING_APPROVAL");
    expect(await stageOf(id)).toBe(f.stage("qualified"));
    const request = await waiting(id);
    expect(request).toMatchObject({
      kind: "DEAL_STAGE",
      operation: "UPDATE",
      changes: { stageId: f.stage("won"), stageReason: "PO signed" },
      dependencies: expect.objectContaining({
        version: 1,
        rule: "CLOSING",
        from: expect.objectContaining({ id: f.stage("qualified") }),
        to: expect.objectContaining({ id: f.stage("won"), category: "WON" }),
      }),
    });
    const days =
      (request.expiresAt!.getTime() - request.createdAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);

    // One waiting request per deal, and no other moves meanwhile.
    await grantEditor(id, f.viewer.id, f.admin.id);
    await expect(
      update(id, { stageId: f.stage("lost"), stageReason: "x" }, f.viewer.id),
    ).rejects.toMatchObject({
      code: "STAGE_REQUEST_PENDING",
      message: "A stage change is already pending for this deal.",
    });
    await expect(
      update(id, { stageId: f.stage("proposal") }, f.seller.id),
    ).rejects.toMatchObject({ code: "STAGE_REQUEST_PENDING" });

    // Who sees what.
    const mine = await dealRecordFor(f.seller, { recordId: id });
    expect(mine.deal.request).toMatchObject({
      visible: true,
      toStageId: f.stage("won"),
      note: "PO signed",
      canWithdraw: true,
      canDecide: false,
    });
    expect(
      (await dealRecordFor(f.viewer, { recordId: id })).deal.request,
    ).toEqual({ visible: false });
    expect(
      (await dealRecordFor(f.admin, { recordId: id })).deal.request,
    ).toMatchObject({ visible: true, canDecide: true });
    const lane = (lanes: Awaited<ReturnType<typeof dealLanesFor>>) =>
      lanes.lanes.find((item) => item.stageId === f.stage("won"))!.waiting;
    expect(lane(await dealLanesFor(f.admin, { boardId: f.boardId }))).toEqual([
      expect.objectContaining({ dealId: id, from: "Qualified" }),
    ]);
    expect(lane(await dealLanesFor(f.viewer, { boardId: f.boardId }))).toEqual(
      [],
    );

    // No self-approval; the approver's approval makes the move atomically.
    await expect(
      decide(request.id, "approve", f.seller.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await decide(request.id, "approve", f.admin.id)).toMatchObject({
      status: "APPROVED",
    });
    const profile = await db.dealProfile.findUniqueOrThrow({
      where: { recordId: id },
    });
    expect(profile.stageId).toBe(f.stage("won"));
    expect(profile.closedAt).not.toBeNull();
    const [latest] = (await dealRecordFor(f.seller, { recordId: id })).history;
    expect(latest).toMatchObject({
      kind: "WON",
      actor: "admin",
      requestedBy: "seller",
      reason: "PO signed",
    });
    await expect(
      decide(request.id, "approve", f.admin.id),
    ).rejects.toMatchObject({ code: "PROPOSAL_CLOSED" });
  });

  it("refuse moves that would skip a request", async () => {
    const f = await fixture();
    const id = applied(await create(f.boardId, f.seller.id));
    await expect(
      update(id, { stageId: f.stage("won"), amount: 5 }, f.seller.id),
    ).rejects.toMatchObject({ code: "STAGE_CHANGE_ALONE" });
    await expect(
      create(f.boardId, f.seller.id, { stageId: f.stage("won") }),
    ).rejects.toMatchObject({ code: "STAGE_APPROVAL_REQUIRED" });
    // Starting in another open stage is fine under the closing rule.
    applied(
      await create(f.boardId, f.seller.id, { stageId: f.stage("proposal") }),
    );
    // The database keeps one waiting request per deal, however it's written.
    await update(id, { stageId: f.stage("won") }, f.seller.id);
    const request = await waiting(id);
    await expect(
      db.boardProposal.create({
        data: {
          boardId: f.boardId,
          taskId: id,
          authorId: f.viewer.id,
          operation: "UPDATE",
          kind: "DEAL_STAGE",
          requestKey: createRecordId(),
          requestDigest: "x",
          changes: { stageId: f.stage("lost") },
          baseline: {},
          policySnapshot: {},
          policyVersion: 1,
          dependencies: request.dependencies!,
          expiresAt: request.expiresAt,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "BoardProposal" SET "changes" = '{"stageId":"x","amount":1}' WHERE "id" = $1`,
        request.id,
      ),
    ).rejects.toThrow(/stage_request_check/);
  });

  it("go back for resubmitting when what they depend on changes", async () => {
    const f = await fixture();
    const id = applied(
      await create(f.boardId, f.seller.id, { stageId: f.stage("proposal") }),
    );
    await update(id, { stageId: f.stage("won") }, f.seller.id);
    const first = await waiting(id);
    // Notes and names aren't dependencies; anyone editing can change them.
    await grantEditor(id, f.viewer.id, f.admin.id);
    await update(id, { description: "Call on Monday" }, f.viewer.id);
    expect((await waiting(id)).id).toBe(first.id);
    // The expected close date is.
    await update(id, { dueDate: "2026-12-01" }, f.viewer.id);
    expect(
      await db.boardProposal.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({
      status: "STALE",
      reason: "The expected close date changed after the request was sent.",
    });
    const record = await dealRecordFor(f.seller, { recordId: id });
    expect(record.deal.request).toBeNull();
    expect(record.closedRequest).toMatchObject({
      id: first.id,
      status: "STALE",
      toStageName: "Won",
    });
    // Resubmitting is a fresh request; archiving closes it for good.
    await update(id, { stageId: f.stage("won") }, f.seller.id);
    const second = await waiting(id);
    expect(second.id).not.toBe(first.id);
    await serial((tx) =>
      mutateTaskInTransaction(
        tx,
        "archive",
        { taskId: id, revision: second.sourceRevision! },
        f.seller.id,
      ),
    );
    expect(
      await db.boardProposal.findUniqueOrThrow({ where: { id: second.id } }),
    ).toMatchObject({
      status: "INVALIDATED",
      reason: "The deal was archived.",
    });
    // A stale request can't be approved after the fact.
    await expect(decide(first.id, "approve", f.admin.id)).rejects.toMatchObject(
      {
        code: "PROPOSAL_CLOSED",
      },
    );
  });

  it("are withdrawn, cancelled, rejected, expired or invalidated", async () => {
    const f = await fixture("approver");
    const deal = async () => {
      const id = applied(await create(f.boardId, f.seller.id));
      await update(id, { stageId: f.stage("won") }, f.seller.id);
      return { id, request: await waiting(id) };
    };
    const withdrawn = await deal();
    await expect(
      decide(withdrawn.request.id, "withdraw", f.viewer.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await decide(withdrawn.request.id, "withdraw", f.seller.id),
    ).toMatchObject({ status: "WITHDRAWN" });

    // Managers cancel others' requests, with a reason the requester sees.
    const cancelled = await deal();
    await expect(
      decide(cancelled.request.id, "cancel", f.viewer.id, "No"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      decide(cancelled.request.id, "cancel", f.admin.id),
    ).rejects.toThrow();
    expect(
      await decide(
        cancelled.request.id,
        "cancel",
        f.admin.id,
        "Replacing the Won stage",
      ),
    ).toMatchObject({ status: "CANCELLED", reason: "Replacing the Won stage" });
    expect(
      await db.notification.findFirst({
        where: { proposalId: cancelled.request.id, recipientId: f.seller.id },
      }),
    ).toMatchObject({ message: "cancelled your request" });

    const rejected = await deal();
    expect(
      await decide(rejected.request.id, "reject", f.reviewer.id, "Not yet"),
    ).toMatchObject({ status: "REJECTED" });
    expect(await stageOf(rejected.id)).toBe(f.stage("new"));

    // Thirty days without a decision: expired at decision time or by sweep.
    const late = await deal();
    const swept = await deal();
    await db.boardProposal.updateMany({
      where: { id: { in: [late.request.id, swept.request.id] } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      await decide(late.request.id, "approve", f.reviewer.id),
    ).toMatchObject({ status: "EXPIRED" });
    expect(await stageOf(late.id)).toBe(f.stage("new"));
    await db.$transaction((tx) =>
      expireStageRequests(tx, { boardId: f.boardId }),
    );
    expect(
      await db.boardProposal.findUniqueOrThrow({
        where: { id: swept.request.id },
      }),
    ).toMatchObject({ status: "EXPIRED", decidedById: null });

    // A deactivated requester's request can't be applied.
    const gone = await deal();
    await db.user.update({
      where: { id: f.seller.id },
      data: { deactivatedAt: new Date() },
    });
    expect(
      await decide(gone.request.id, "approve", f.reviewer.id),
    ).toMatchObject({ status: "INVALIDATED" });
    await db.user.update({
      where: { id: f.seller.id },
      data: { deactivatedAt: null },
    });

    // Deleting the deal closes its request.
    const deleted = await deal();
    await serial((tx) =>
      deleteRecordInTransaction(tx, { id: deleted.id }, f.admin.id),
    );
    expect(
      await db.boardProposal.findUniqueOrThrow({
        where: { id: deleted.request.id },
      }),
    ).toMatchObject({ status: "INVALIDATED", reason: "The deal was deleted." });
  });

  it("follow the pipeline's rule and block stage changes they use", async () => {
    const f = await fixture();
    const version = async () =>
      (await db.pipeline.findUniqueOrThrow({ where: { boardId: f.boardId } }))
        .version;
    await changeStagesFor(f.admin, {
      boardId: f.boardId,
      version: await version(),
      action: "approvals",
      rule: "ALL",
    });
    const id = applied(await create(f.boardId, f.seller.id));
    expect(
      (await update(id, { stageId: f.stage("qualified") }, f.seller.id))
        .outcome,
    ).toBe("PENDING_APPROVAL");
    const open = await waiting(id);
    // Back to closing only: that request no longer needs approval.
    await changeStagesFor(f.admin, {
      boardId: f.boardId,
      version: await version(),
      action: "approvals",
      rule: "CLOSING",
    });
    expect(
      await db.boardProposal.findUniqueOrThrow({ where: { id: open.id } }),
    ).toMatchObject({ status: "STALE" });
    expect(
      (await update(id, { stageId: f.stage("qualified") }, f.seller.id))
        .outcome,
    ).toBe("APPLIED");

    // A waiting request keeps its stages from being removed or recategorized.
    await changeStagesFor(f.admin, {
      boardId: f.boardId,
      version: await version(),
      action: "add",
      name: "Signed",
      category: "WON",
    });
    const signed = (await db.pipelineStage.findFirstOrThrow({
      where: { boardId: f.boardId, name: "Signed" },
    }))!.id;
    await update(id, { stageId: signed }, f.seller.id);
    await expect(
      changeStagesFor(f.admin, {
        boardId: f.boardId,
        version: await version(),
        action: "remove",
        stageId: signed,
      }),
    ).rejects.toMatchObject({
      code: "STAGE_IN_USE",
      details: {
        total: 0,
        requests: [
          expect.objectContaining({
            dealId: id,
            to: "Signed",
            authorName: "seller",
          }),
        ],
      },
    });
    // Turning approvals off sends it back at decision time.
    await db.boardApprovalPolicy.update({
      where: { boardId: f.boardId },
      data: { enabled: false },
    });
    expect(
      await decide((await waiting(id)).id, "approve", f.admin.id),
    ).toMatchObject({ status: "STALE" });
  });
});
