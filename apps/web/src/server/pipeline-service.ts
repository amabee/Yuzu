import {
  createRecordId,
  getDatabase,
  type DatabaseTransaction,
  type Prisma,
} from "@yuzu/database";
import { z } from "zod";
import {
  MAX_STAGES,
  defaultStages,
  dealFields,
  pipelineCreateSchema,
  stageCommandSchema,
  type PipelineList,
  type PipelineSummary,
  type StageCategory,
} from "@/lib/deal-contract";
import { recordId } from "@/lib/id-contract";
import { builtinName, resolveRecordConfig } from "@/lib/record-types";
import { access, serial } from "./board-service";
import { readApprovalPolicy } from "./approval-policy";
import { SetupError } from "./setup/security";
import {
  isAdministrator,
  requireIdentity,
  workspaceScope,
} from "./team-access";

/**
 * CRM pipelines (docs/specs/deals-pipelines.md). Each is a standalone Deal
 * board in a workspace with its own stages. Stage configuration locks the
 * pipeline row and checks its version, inside a serializable transaction;
 * the database re-checks one stage per category and an Open default.
 */
type Viewer = { id: string; role: string };
const unavailable = () =>
  new SetupError(404, "NOT_FOUND", "This pipeline is not available to you.");
const changed = () =>
  new SetupError(
    409,
    "PIPELINE_CHANGED",
    "Someone changed this pipeline's stages. The latest version is showing now.",
  );

/** Pipeline boards' columns: deal fields are adapters to the DealProfile. */
function pipelineColumns() {
  const record = resolveRecordConfig("DEAL", {});
  const columns = [
    ["name", record.singular, "TEXT"],
    ["assignees", builtinName(record, "assignees"), "PEOPLE"],
    ["due_date", builtinName(record, "dueDate"), "DATE"],
    ["description", builtinName(record, "description"), "LONG_TEXT"],
    [dealFields.stageId.column, "Stage", "TEXT"],
    [dealFields.amount.column, "Amount", "NUMBER"],
    [dealFields.currency.column, "Currency", "TEXT"],
    [dealFields.customerCompanyId.column, "Customer", "TEXT"],
  ] as const;
  return columns.map(([key, name, type], position) => ({
    key,
    name,
    type,
    position,
    ...(key.startsWith("deal_") ? { config: { system: true } } : {}),
  }));
}

/** Administrators, and people managing a board in this workspace. */
async function mayCreate(
  tx: DatabaseTransaction,
  viewer: Viewer,
  workspaceId: string,
) {
  if (isAdministrator(viewer.role)) return true;
  return (
    (await tx.board.count({
      where: {
        workspaceId,
        deletedAt: null,
        managers: { some: { userId: viewer.id } },
      },
    })) > 0
  );
}

export async function createPipeline(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return createPipelineFor(user, input);
}
export async function createPipelineFor(viewer: Viewer, input: unknown) {
  const body = pipelineCreateSchema.parse(input);
  return serial(async (tx) => {
    const workspace = await tx.workspace.findFirst({
      where: { id: body.workspaceId, ...workspaceScope(viewer) },
      select: { id: true },
    });
    if (!workspace)
      throw new SetupError(
        404,
        "NOT_FOUND",
        "This workspace is not available to you.",
      );
    if (!(await mayCreate(tx, viewer, workspace.id)))
      throw new SetupError(
        403,
        "FORBIDDEN",
        "Ask an administrator or a board manager to add pipelines.",
      );
    if (
      (
        await tx.installationSettings.findUnique({
          where: { id: "installation" },
        })
      )?.maintenanceMode
    )
      throw new SetupError(
        503,
        "MAINTENANCE",
        "Changes are paused during maintenance.",
      );
    const record = resolveRecordConfig("DEAL", {});
    const board = await tx.board.create({
      data: {
        workspaceId: workspace.id,
        name: body.name,
        createdById: viewer.id,
        recordType: "DEAL",
        recordConfig: record,
        managers: { create: { userId: viewer.id, grantedById: viewer.id } },
        columns: { create: pipelineColumns() },
        groups: { create: { name: record.plural, position: 0 } },
      },
      select: { id: true },
    });
    const ids = defaultStages.map(() => createRecordId());
    await tx.pipeline.create({ data: { boardId: board.id } });
    await tx.pipelineStage.createMany({
      data: defaultStages.map((stage, position) => ({
        id: ids[position]!,
        boardId: board.id,
        ...stage,
        position,
      })),
    });
    await tx.pipeline.update({
      where: { boardId: board.id },
      data: { defaultStageId: ids[0] },
    });
    await tx.boardEvent.create({
      data: {
        boardId: board.id,
        actorId: viewer.id,
        action: "Created pipeline",
      },
    });
    return { boardId: board.id };
  });
}

/** The pipeline row, locked for a stage configuration change. */
async function lockedPipeline(
  tx: DatabaseTransaction,
  viewer: Viewer,
  boardId: string,
  version: number,
) {
  const context = await access(tx, viewer.id, boardId, true);
  if (!context.canManage)
    throw new SetupError(
      403,
      "FORBIDDEN",
      "Only this pipeline's managers can change its stages.",
    );
  const locked = await tx.$queryRaw<{ version: number }[]>`
    SELECT "version" FROM "Pipeline" WHERE "boardId" = ${boardId} FOR UPDATE`;
  if (!locked.length) throw unavailable();
  if (locked[0]!.version !== version) throw changed();
  const pipeline = await tx.pipeline.findUniqueOrThrow({
    where: { boardId },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  return { context, pipeline };
}
/** Deals in a stage, of any state, with the first few the viewer can see. */
async function stageBlockers(tx: DatabaseTransaction, stageId: string) {
  const where: Prisma.DealProfileWhereInput = { stageId };
  const [total, deals] = await Promise.all([
    tx.dealProfile.count({ where }),
    tx.dealProfile.findMany({
      where,
      take: 20,
      orderBy: { recordId: "asc" },
      select: {
        record: {
          select: { id: true, name: true, archivedAt: true, deletedAt: true },
        },
      },
    }),
  ]);
  return {
    total,
    deals: deals.map(({ record }) => ({
      id: record.id,
      name: record.name,
      state: record.deletedAt
        ? ("TRASH" as const)
        : record.archivedAt
          ? ("ARCHIVED" as const)
          : ("LIVE" as const),
    })),
  };
}
const inUse = (
  blockers: Awaited<ReturnType<typeof stageBlockers>>,
  what: string,
) =>
  Object.assign(
    new SetupError(
      409,
      "STAGE_IN_USE",
      `${blockers.total.toLocaleString("en-US")} ${blockers.total === 1 ? "deal is" : "deals are"} in this stage, including archived deals and deals in Trash. Move them to another stage before you ${what}. Archived deals must be restored first; deals in Trash must be restored or permanently deleted by an administrator.`,
    ),
    { details: blockers },
  );
const stageKey = (name: string, taken: Set<string>) => {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "stage";
  let key = base;
  for (let index = 2; taken.has(key); index++) key = `${base}_${index}`;
  return key;
};

export async function changeStages(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return changeStagesFor(user, input);
}
export async function changeStagesFor(viewer: Viewer, input: unknown) {
  const body = stageCommandSchema.parse(input);
  return serial(async (tx) => {
    const { pipeline } = await lockedPipeline(
      tx,
      viewer,
      body.boardId,
      body.version,
    );
    const stages = pipeline.stages;
    const find = (id: string) => {
      const stage = stages.find((item) => item.id === id);
      if (!stage)
        throw new SetupError(
          404,
          "NOT_FOUND",
          "This stage was removed. The latest stages are showing now.",
        );
      return stage;
    };
    const nameTaken = (name: string, except?: string) =>
      stages.some(
        (stage) =>
          stage.id !== except &&
          stage.name.toLowerCase() === name.toLowerCase(),
      );
    const duplicate = () =>
      new SetupError(
        422,
        "STAGE_NAME_TAKEN",
        "Another stage already has this name.",
      );
    const leaves = (category: string, except: string) =>
      !stages.some(
        (stage) => stage.id !== except && stage.category === category,
      );
    const lastOf = (category: string) =>
      new SetupError(
        422,
        "LAST_STAGE_IN_CATEGORY",
        `A pipeline keeps at least one ${category === "OPEN" ? "Open" : category === "WON" ? "Won" : "Lost"} stage.`,
      );
    if (body.action === "add") {
      if (stages.length >= MAX_STAGES)
        throw new SetupError(
          422,
          "TOO_MANY_STAGES",
          `A pipeline can have up to ${MAX_STAGES} stages.`,
        );
      if (nameTaken(body.name)) throw duplicate();
      // New stages join the end of their category's run.
      const position =
        Math.max(
          -1,
          ...stages
            .filter((stage) => stage.category === body.category)
            .map((stage) => stage.position),
        ) + 1;
      await tx.pipelineStage.updateMany({
        where: { boardId: body.boardId, position: { gte: position } },
        data: { position: { increment: 1 } },
      });
      await tx.pipelineStage.create({
        data: {
          boardId: body.boardId,
          key: stageKey(body.name, new Set(stages.map((stage) => stage.key))),
          name: body.name,
          category: body.category,
          position,
        },
      });
    } else if (body.action === "update") {
      const stage = find(body.stageId);
      if (body.name && nameTaken(body.name, stage.id)) throw duplicate();
      if (body.category && body.category !== stage.category) {
        if (leaves(stage.category, stage.id)) throw lastOf(stage.category);
        if (stage.id === pipeline.defaultStageId)
          throw new SetupError(
            422,
            "DEFAULT_STAGE",
            "The default stage stays Open. Choose another default first.",
          );
        const blockers = await stageBlockers(tx, stage.id);
        if (blockers.total) throw inUse(blockers, "change its category");
      }
      await tx.pipelineStage.update({
        where: { id: stage.id },
        data: {
          ...(body.name ? { name: body.name } : {}),
          ...(body.category ? { category: body.category } : {}),
        },
      });
    } else if (body.action === "move") {
      const stage = find(body.stageId);
      const order = stages.filter((item) => item.id !== stage.id);
      order.splice(Math.min(body.position, order.length), 0, stage);
      for (const [position, item] of order.entries())
        if (item.position !== position)
          await tx.pipelineStage.update({
            where: { id: item.id },
            data: { position },
          });
    } else if (body.action === "remove") {
      const stage = find(body.stageId);
      if (stage.id === pipeline.defaultStageId)
        throw new SetupError(
          422,
          "DEFAULT_STAGE",
          "Choose another default stage before removing this one.",
        );
      if (leaves(stage.category, stage.id)) throw lastOf(stage.category);
      const blockers = await stageBlockers(tx, stage.id);
      if (blockers.total) throw inUse(blockers, "remove it");
      await tx.pipelineStage.delete({ where: { id: stage.id } });
      await tx.pipelineStage.updateMany({
        where: { boardId: body.boardId, position: { gt: stage.position } },
        data: { position: { decrement: 1 } },
      });
    } else {
      const stage = find(body.stageId);
      if (stage.category !== "OPEN")
        throw new SetupError(
          422,
          "DEFAULT_STAGE",
          "New deals start in an Open stage. Choose an Open stage.",
        );
      await tx.pipeline.update({
        where: { boardId: body.boardId },
        data: { defaultStageId: stage.id },
      });
    }
    const after = await tx.pipeline.update({
      where: { boardId: body.boardId },
      data: { version: { increment: 1 } },
    });
    await tx.boardEvent.create({
      data: {
        boardId: body.boardId,
        actorId: viewer.id,
        action: "Changed pipeline stages",
        after: { action: body.action },
      },
    });
    return { boardId: body.boardId, version: after.version };
  });
}

/** Live-deal counts and per-currency totals for each stage. */
async function stageTotals(tx: DatabaseTransaction, boardIds: string[]) {
  const rows = await tx.dealProfile.groupBy({
    by: ["boardId", "stageId", "currency"],
    where: {
      boardId: { in: boardIds },
      record: { deletedAt: null, archivedAt: null },
    },
    _count: { _all: true },
    _sum: { amount: true },
  });
  return rows;
}
const addTotal = (
  totals: Record<string, string>,
  currency: string | null,
  amount: { toString(): string } | null,
) => {
  if (!currency || amount === null) return;
  // Decimal text sums exactly via scaled BigInt (4 decimals).
  const SCALE = BigInt(10000);
  const scaled = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole!) * SCALE + BigInt((fraction + "0000").slice(0, 4));
  };
  const sum = scaled(totals[currency] ?? "0") + scaled(amount.toString());
  const whole = sum / SCALE;
  const fraction = (sum % SCALE).toString().padStart(4, "0").replace(/0+$/, "");
  totals[currency] = `${whole}${fraction ? `.${fraction}` : ""}`;
};

/** The workspace's pipelines, with their open deals' counts and value. */
export async function listPipelines(
  workspaceId: string,
  headers: Headers,
): Promise<PipelineList> {
  const { user } = await requireIdentity(headers);
  return listPipelinesFor(user, workspaceId);
}
export async function listPipelinesFor(
  viewer: Viewer,
  workspaceId: string,
): Promise<PipelineList> {
  const id = recordId.parse(workspaceId);
  return getDatabase().$transaction(async (tx) => {
    const workspace = await tx.workspace.findFirst({
      where: { id, ...workspaceScope(viewer) },
      select: { id: true },
    });
    if (!workspace)
      throw new SetupError(
        404,
        "NOT_FOUND",
        "This workspace is not available to you.",
      );
    const boards = await tx.board.findMany({
      where: { workspaceId: id, deletedAt: null, pipeline: { isNot: null } },
      orderBy: [
        { archivedAt: { sort: "asc", nulls: "first" } },
        { name: "asc" },
      ],
      take: 200,
      select: {
        id: true,
        name: true,
        archivedAt: true,
        pipeline: {
          select: { stages: { select: { id: true, category: true } } },
        },
      },
    });
    const totals = await stageTotals(
      tx,
      boards.map((board) => board.id),
    );
    const settings = await tx.installationSettings.findUnique({
      where: { id: "installation" },
      select: { currency: true },
    });
    return {
      workspaceId: id,
      canCreate: await mayCreate(tx, viewer, id),
      currency: settings?.currency ?? "PHP",
      pipelines: boards.map((board) => {
        const open = new Set(
          board
            .pipeline!.stages.filter((stage) => stage.category === "OPEN")
            .map((stage) => stage.id),
        );
        const openTotals: Record<string, string> = {};
        let openCount = 0;
        for (const row of totals)
          if (row.boardId === board.id && open.has(row.stageId)) {
            openCount += row._count._all;
            addTotal(openTotals, row.currency, row._sum.amount);
          }
        return {
          boardId: board.id,
          name: board.name,
          archived: Boolean(board.archivedAt),
          openCount,
          openTotals,
        };
      }),
    };
  });
}

/** A pipeline's stages with live-deal counts and totals per currency. */
export async function pipelineSummary(
  boardId: string,
  headers: Headers,
): Promise<PipelineSummary> {
  const { user } = await requireIdentity(headers);
  return pipelineSummaryFor(user, boardId);
}
export async function pipelineSummaryFor(
  viewer: Viewer,
  boardId: string,
): Promise<PipelineSummary> {
  const id = recordId.parse(boardId);
  return getDatabase().$transaction(async (tx) => {
    const context = await access(tx, viewer.id, id);
    const pipeline = await tx.pipeline.findUnique({
      where: { boardId: id },
      include: { stages: { orderBy: { position: "asc" } } },
    });
    if (!pipeline) throw unavailable();
    const totals = await stageTotals(tx, [id]);
    return {
      boardId: id,
      name: context.board.name,
      version: pipeline.version,
      defaultStageId: pipeline.defaultStageId!,
      archived: context.readOnly,
      canManage: context.canManage,
      approvals: (await readApprovalPolicy(tx, context.board)).enabled,
      stages: pipeline.stages.map((stage) => {
        const stageTotals: Record<string, string> = {};
        let count = 0;
        for (const row of totals)
          if (row.stageId === stage.id) {
            count += row._count._all;
            addTotal(stageTotals, row.currency, row._sum.amount);
          }
        return {
          id: stage.id,
          key: stage.key,
          name: stage.name,
          category: stage.category as StageCategory,
          position: stage.position,
          count,
          totals: stageTotals,
        };
      }),
    };
  });
}
export const pipelineIdSchema = z.object({ boardId: recordId }).strict();
