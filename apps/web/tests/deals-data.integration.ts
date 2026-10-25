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
import { crmCollection } from "@/server/crm-service";
import {
  changeStagesFor,
  createPipelineFor,
  listPipelinesFor,
  pipelineSummaryFor,
} from "@/server/pipeline-service";
import {
  customerDealsFor,
  dealLanesFor,
  dealListFor,
  dealRecordFor,
} from "@/server/deals-service";
import {
  deleteRecordInTransaction,
  eraseBatch,
  eraseSelection,
} from "@/server/trash-service";
import { workBoardWhere } from "@/lib/record-types";

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
    throw new Error("Could not migrate the isolated deals test database.");
  await db.installationSettings.upsert({
    where: { id: "installation" },
    create: { setupState: "READY", currency: "PHP" },
    update: { setupState: "READY", maintenanceMode: false, currency: "PHP" },
  });
});
afterAll(async () => {
  // Only fixtures created by this file, and only yuzu_e2e. No dev-data reset.
  const boards = { board: { workspaceId: { in: workspaceIds } } };
  await db.boardProposal.deleteMany({ where: boards });
  await db.task.deleteMany({ where: boards });
  await db.board.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});

async function fixture() {
  const people = await Promise.all(
    ["admin", "seller", "teammate"].map((name) =>
      db.user.create({
        data: {
          name,
          email: `${createRecordId()}@deals.test`,
          emailVerified: true,
          role: name === "admin" ? "ADMIN" : "MEMBER",
        },
      }),
    ),
  );
  const [admin, seller, teammate] = people;
  userIds.push(...people.map((person) => person.id));
  const workspace = await db.workspace.create({
    data: {
      name: "Deals integration",
      createdById: admin.id,
      members: {
        create: [seller, teammate].map((person) => ({ userId: person.id })),
      },
    },
  });
  workspaceIds.push(workspace.id);
  const { boardId } = await createPipelineFor(admin, {
    workspaceId: workspace.id,
    name: "New business",
  });
  const companies = await crmCollection(seller, workspace.id, "COMPANY");
  const contacts = await crmCollection(seller, workspace.id, "CONTACT");
  const stages = await db.pipelineStage.findMany({
    where: { boardId },
    orderBy: { position: "asc" },
  });
  const stage = (key: string) => stages.find((item) => item.key === key)!.id;
  return {
    admin,
    seller,
    teammate,
    workspace,
    boardId,
    companies,
    contacts,
    stage,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
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
      { taskId: id, revision: await revision(id), changes },
      userId,
    ),
  );
const raw = (sql: string, ...values: unknown[]) =>
  db.$executeRawUnsafe(sql, ...values);
const profile = (recordId: string) =>
  db.dealProfile.findUniqueOrThrow({ where: { recordId } });

describe("Pipelines", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
  });

  it("start with the approved stages, an Open default, and stay out of Work", async () => {
    const summary = await pipelineSummaryFor(f.seller, f.boardId);
    expect(summary.stages.map((stage) => [stage.name, stage.category])).toEqual(
      [
        ["New", "OPEN"],
        ["Qualified", "OPEN"],
        ["Proposal", "OPEN"],
        ["Negotiation", "OPEN"],
        ["Won", "WON"],
        ["Lost", "LOST"],
      ],
    );
    expect(summary.defaultStageId).toBe(f.stage("new"));
    expect(summary.canManage).toBe(false);
    expect(
      await db.board.count({
        where: { workspaceId: f.workspace.id, ...workBoardWhere },
      }),
    ).toBe(0);
    // Members who manage no board here can't add pipelines; managers can.
    await expect(
      createPipelineFor(f.seller, { workspaceId: f.workspace.id, name: "X" }),
    ).rejects.toMatchObject({ status: 403 });
    await db.boardManager.create({
      data: {
        boardId: f.boardId,
        userId: f.seller.id,
        grantedById: f.admin.id,
      },
    });
    await expect(
      createPipelineFor(f.seller, {
        workspaceId: f.workspace.id,
        name: "Renewals",
      }),
    ).resolves.toMatchObject({ boardId: expect.any(String) });
    expect(
      (await listPipelinesFor(f.teammate, f.workspace.id)).pipelines.map(
        (item) => item.name,
      ),
    ).toEqual(["New business", "Renewals"]);
  });

  it("keeps one stage per category and an Open default, under concurrency", async () => {
    const at = async () =>
      (await db.pipeline.findUniqueOrThrow({ where: { boardId: f.boardId } }))
        .version;
    const command = async (body: Record<string, unknown>) =>
      changeStagesFor(f.admin, {
        boardId: f.boardId,
        version: await at(),
        ...body,
      });
    await expect(
      command({ action: "update", stageId: f.stage("won"), category: "OPEN" }),
    ).rejects.toMatchObject({ code: "LAST_STAGE_IN_CATEGORY" });
    await expect(
      command({ action: "remove", stageId: f.stage("lost") }),
    ).rejects.toMatchObject({ code: "LAST_STAGE_IN_CATEGORY" });
    await expect(
      command({ action: "default", stageId: f.stage("won") }),
    ).rejects.toMatchObject({ code: "DEFAULT_STAGE" });
    await expect(
      command({ action: "remove", stageId: f.stage("new") }),
    ).rejects.toMatchObject({ code: "DEFAULT_STAGE" });
    await expect(
      command({ action: "add", name: "won", category: "WON" }),
    ).rejects.toMatchObject({ code: "STAGE_NAME_TAKEN" });
    await command({ action: "add", name: "Signed", category: "WON" });
    await command({
      action: "update",
      stageId: f.stage("new"),
      name: "Lead in",
    });
    const version = await at();
    // Two people changing the same version: one wins, one reloads.
    const results = await Promise.allSettled([
      changeStagesFor(f.admin, {
        boardId: f.boardId,
        version,
        action: "remove",
        stageId: f.stage("qualified"),
      }),
      changeStagesFor(f.admin, {
        boardId: f.boardId,
        version,
        action: "remove",
        stageId: f.stage("proposal"),
      }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.find((item) => item.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ code: "PIPELINE_CHANGED" }),
    });
    const summary = await pipelineSummaryFor(f.admin, f.boardId);
    expect(summary.stages.map((stage) => stage.name)).toContain("Signed");
    expect(
      summary.stages.find((stage) => stage.id === f.stage("new"))?.name,
    ).toBe("Lead in");
    // Only managers change stages.
    await expect(
      changeStagesFor(f.teammate, {
        boardId: f.boardId,
        version: await at(),
        action: "add",
        name: "Demo",
        category: "OPEN",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("Deals", () => {
  let f: Fixture;
  let acme: string, ana: string;
  beforeAll(async () => {
    f = await fixture();
    acme = applied(await create(f.companies, f.seller.id, { name: "Acme" }));
    ana = applied(await create(f.contacts, f.seller.id, { name: "Ana" }));
  });

  it("start in the default stage, owned by their creator, with history", async () => {
    const id = applied(await create(f.boardId, f.seller.id));
    expect(await profile(id)).toMatchObject({
      stageId: f.stage("new"),
      amount: null,
      closedAt: null,
    });
    const record = await dealRecordFor(f.seller, { recordId: id });
    expect(record.deal).toMatchObject({ ownerId: f.seller.id, customer: null });
    expect(record.history).toEqual([
      expect.objectContaining({
        kind: "CREATED",
        to: "New",
        toCategory: "OPEN",
      }),
    ]);
  });

  it("validate value, currency and one visible customer", async () => {
    const id = applied(
      await create(f.boardId, f.seller.id, {
        amount: "12,500.50",
        customerCompanyId: acme,
      }),
    );
    const saved = await profile(id);
    expect(saved.amount?.toString()).toBe("12500.5");
    expect(saved.currency).toBe("PHP");
    expect(saved.customerCompanyId).toBe(acme);
    // Choosing a person replaces the company.
    await update(id, { customerContactId: ana }, f.seller.id);
    expect(await profile(id)).toMatchObject({
      customerCompanyId: null,
      customerContactId: ana,
    });
    await expect(
      update(
        id,
        { customerCompanyId: acme, customerContactId: ana },
        f.seller.id,
      ),
    ).rejects.toMatchObject({ code: "ONE_CUSTOMER" });
    const other = await fixture();
    const elsewhere = applied(
      await create(other.companies, other.seller.id, { name: "Far" }),
    );
    await expect(
      update(id, { customerCompanyId: elsewhere }, f.seller.id),
    ).rejects.toMatchObject({ code: "INVALID_CUSTOMER" });
    await expect(
      update(id, { customerCompanyId: ana }, f.seller.id),
    ).rejects.toMatchObject({ code: "INVALID_CUSTOMER" });
    await expect(
      update(id, { stageId: other.stage("new") }, f.seller.id),
    ).rejects.toMatchObject({ code: "INVALID_STAGE" });
    await expect(update(id, { amount: "-1" }, f.seller.id)).rejects.toThrow();
    // Deal fields stay off other boards.
    await expect(
      create(f.companies, f.seller.id, {
        name: "Bad",
        stageId: f.stage("new"),
      }),
    ).rejects.toMatchObject({ code: "FIELD_NOT_AVAILABLE" });
  });

  it("close, reopen and move between Won and Lost with history", async () => {
    const id = applied(
      await create(f.boardId, f.seller.id, { amount: 1000, currency: "usd" }),
    );
    await update(id, { stageId: f.stage("won") }, f.seller.id);
    const won = await profile(id);
    expect(won.closedAt).not.toBeNull();
    await expect(
      update(id, { stageId: f.stage("lost") }, f.seller.id),
    ).rejects.toMatchObject({ code: "STAGE_REASON_REQUIRED" });
    await update(
      id,
      { stageId: f.stage("lost"), stageReason: "Chose a competitor" },
      f.seller.id,
    );
    const lost = await profile(id);
    expect(lost.closedAt!.getTime()).toBeGreaterThanOrEqual(
      won.closedAt!.getTime(),
    );
    await update(id, { stageId: f.stage("negotiation") }, f.seller.id);
    expect((await profile(id)).closedAt).toBeNull();
    const history = (await dealRecordFor(f.seller, { recordId: id })).history;
    expect(history.map((event) => event.kind)).toEqual([
      "REOPENED",
      "LOST",
      "WON",
      "CREATED",
    ]);
    expect(history[1]).toMatchObject({
      reason: "Chose a competitor",
      amount: "1000",
      currency: "USD",
    });
    // History is immutable, even for direct writes.
    await expect(
      raw(`UPDATE "DealStageEvent" SET "reason" = 'x' WHERE "dealId" = $1`, id),
    ).rejects.toThrow(/immutable/);
  });

  it("send protected deal fields for approval like any field", async () => {
    const id = applied(await create(f.boardId, f.seller.id, { amount: 10 }));
    const amount = await db.boardColumn.findFirstOrThrow({
      where: { boardId: f.boardId, key: "deal_amount" },
    });
    await db.boardApprovalPolicy.create({
      data: {
        boardId: f.boardId,
        enabled: true,
        requireChanges: true,
        protectedFieldIds: [amount.id],
        primaryApproverId: f.admin.id,
      },
    });
    try {
      const pending = await update(id, { amount: 99 }, f.seller.id);
      expect(pending.outcome).toBe("PENDING_APPROVAL");
      const proposal = await db.boardProposal.findFirstOrThrow({
        where: { taskId: id, status: "PENDING" },
      });
      await serial((tx) =>
        decideApprovalInTransaction(
          tx,
          { proposalId: proposal.id, action: "approve" },
          f.admin.id,
        ),
      );
      expect((await profile(id)).amount?.toString()).toBe("99");
    } finally {
      await db.boardApprovalPolicy.delete({ where: { boardId: f.boardId } });
    }
  });

  it("block removing stages in use, even by archived or trashed deals", async () => {
    const id = applied(
      await create(f.boardId, f.seller.id, { stageId: f.stage("proposal") }),
    );
    await serial((tx) => deleteRecordInTransaction(tx, { id }, f.admin.id));
    const version = (
      await db.pipeline.findUniqueOrThrow({ where: { boardId: f.boardId } })
    ).version;
    await expect(
      changeStagesFor(f.admin, {
        boardId: f.boardId,
        version,
        action: "remove",
        stageId: f.stage("proposal"),
      }),
    ).rejects.toMatchObject({
      code: "STAGE_IN_USE",
      details: {
        total: 1,
        deals: [expect.objectContaining({ state: "TRASH" })],
      },
    });
    await expect(
      raw(`DELETE FROM "PipelineStage" WHERE "id" = $1`, f.stage("proposal")),
    ).rejects.toThrow(/foreign key/);
  });

  it("show lanes, totals per currency and a customer's deals", async () => {
    const other = await fixture();
    const big = applied(
      await create(other.boardId, other.seller.id, {
        name: "Big",
        amount: "1000.25",
        currency: "PHP",
      }),
    );
    await create(other.boardId, other.seller.id, {
      name: "Small",
      amount: "0.75",
      currency: "PHP",
    });
    await create(other.boardId, other.seller.id, {
      name: "Dollar",
      amount: 5,
      currency: "USD",
    });
    const lanes = await dealLanesFor(other.teammate, {
      boardId: other.boardId,
    });
    const fresh = lanes.lanes.find(
      (lane) => lane.stageId === other.stage("new"),
    )!;
    expect(fresh.total).toBe(3);
    const summary = await pipelineSummaryFor(other.teammate, other.boardId);
    expect(
      summary.stages.find((stage) => stage.id === other.stage("new"))?.totals,
    ).toEqual({ PHP: "1001", USD: "5" });
    const list = await dealListFor(other.teammate, {
      boardId: other.boardId,
      sort: "-amount",
    });
    expect(list.deals.map((deal) => deal.name)).toEqual([
      "Big",
      "Dollar",
      "Small",
    ]);
    const pipelines = await listPipelinesFor(
      other.teammate,
      other.workspace.id,
    );
    expect(pipelines.pipelines[0]).toMatchObject({
      openCount: 3,
      openTotals: { PHP: "1001", USD: "5" },
    });
    // Customers see their deals, and purging a customer only unlinks them.
    const company = applied(
      await create(other.companies, other.seller.id, { name: "Northwind" }),
    );
    await update(big, { customerCompanyId: company }, other.seller.id);
    expect(
      (await customerDealsFor(other.teammate, { recordId: company })).map(
        (deal) => deal.name,
      ),
    ).toEqual(["Big"]);
    await serial((tx) =>
      deleteRecordInTransaction(tx, { id: company }, other.admin.id),
    );
    expect(
      (await dealRecordFor(other.teammate, { recordId: big })).deal.customer,
    ).toEqual({ visible: false, type: "COMPANY" });
    await eraseBatch(
      null,
      eraseSelection(new Date(), { kind: "record", id: company }),
      "Deals integration proof",
    );
    expect((await profile(big)).customerCompanyId).toBeNull();
  });
});

describe("Database rules", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
  });

  it("refuse broken pipelines, stray profiles and second customers", async () => {
    const deal = applied(await create(f.boardId, f.seller.id));
    const other = await fixture();
    // A stage from another pipeline can't be used.
    await expect(
      raw(
        `UPDATE "DealProfile" SET "stageId" = $1 WHERE "recordId" = $2`,
        other.stage("new"),
        deal,
      ),
    ).rejects.toThrow(/foreign key/);
    // Removing the last Won stage directly fails at commit.
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `DELETE FROM "PipelineStage" WHERE "id" = $1`,
          other.stage("won"),
        );
      }),
    ).rejects.toThrow(/at least one WON stage/);
    // Both kinds of customer at once are refused.
    const company = applied(
      await create(f.companies, f.seller.id, { name: "C" }),
    );
    const person = applied(
      await create(f.contacts, f.seller.id, { name: "P" }),
    );
    await expect(
      raw(
        `UPDATE "DealProfile" SET "customerCompanyId" = $1, "customerContactId" = $2 WHERE "recordId" = $3`,
        company,
        person,
        deal,
      ),
    ).rejects.toThrow(/one_customer/);
    // Pipelines stay standalone Deal boards.
    await expect(
      raw(
        `UPDATE "Board" SET "recordType" = 'TASK' WHERE "id" = $1`,
        f.boardId,
      ),
    ).rejects.toThrow(/standalone Deal board/);
    const task = await db.board.create({
      data: {
        name: "Tasks",
        workspaceId: f.workspace.id,
        createdById: f.admin.id,
      },
    });
    await expect(
      raw(
        `INSERT INTO "Pipeline" ("boardId","updatedAt") VALUES ($1, now())`,
        task.id,
      ),
    ).rejects.toThrow(/standalone Deal board/);
    // Every pipeline Deal keeps its profile.
    await expect(
      raw(
        `INSERT INTO "Task" ("id","boardId","name","createdById","createKey","createDigest","updatedAt") VALUES ($1,$2,'Raw',$3,$4,'x',now())`,
        createRecordId(),
        f.boardId,
        f.admin.id,
        createRecordId(),
      ),
    ).rejects.toThrow(/needs its profile/);
  });
});
