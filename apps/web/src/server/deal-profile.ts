import type { DatabaseTransaction } from "@yuzu/database";
import {
  dealKeys,
  needsStageReason,
  stageTransition,
  type DealKey,
  type DealValues,
  type StageCategory,
} from "@/lib/deal-contract";
import { SetupError } from "./setup/security";
import { boardScope } from "./team-access";

/**
 * Pipeline Deals on the shared record paths. Create, update, approvals and
 * automation carry deal fields as flat change keys (stageId, amount, ...);
 * this module checks them against the pipeline and writes the DealProfile and
 * its stage history. Deals keep their record revision rules: a stage move is
 * a content change like any other field.
 */
type Board = { id: string; workspaceId: string; recordType: string };
type Viewer = { id: string; role: string };
type DealChanges = Partial<Record<DealKey, unknown>> & {
  stageReason?: string;
};
type Loaded = {
  id: string;
  dealProfile?: {
    stageId: string;
    amount: { toString(): string } | null;
    currency: string | null;
    customerCompanyId: string | null;
    customerContactId: string | null;
    closedAt: Date | null;
  } | null;
};

/** The deal part of a change set (and the stage reason), and the rest. */
export function splitDeal<T extends Record<string, unknown>>(changes: T) {
  const deal: DealChanges = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes))
    if ((dealKeys as string[]).includes(key) || key === "stageReason")
      (deal as Record<string, unknown>)[key] = value;
    else rest[key] = value;
  return { deal, rest: rest as Omit<T, DealKey | "stageReason"> };
}
const touches = (changes: Record<string, unknown>) =>
  Object.keys(changes).some(
    (key) =>
      ((dealKeys as string[]).includes(key) || key === "stageReason") &&
      changes[key] !== undefined,
  );

/** A Deal board's pipeline and stages, or null for any other board. */
export async function pipelineOf(tx: DatabaseTransaction, board: Board) {
  if (board.recordType !== "DEAL") return null;
  return tx.pipeline.findUnique({
    where: { boardId: board.id },
    include: { stages: { orderBy: { position: "asc" } } },
  });
}

const notAvailable = () =>
  new SetupError(
    422,
    "FIELD_NOT_AVAILABLE",
    "Stages, amounts and customers are only available on CRM pipeline deals.",
  );

/** Deal values as they stand, for snapshots, activity and approvals. */
export function dealSnapshot(task: Loaded): Partial<DealValues> {
  const deal = task.dealProfile;
  if (!deal) return {};
  return {
    stageId: deal.stageId,
    amount: deal.amount?.toString() ?? null,
    currency: deal.currency,
    customerCompanyId: deal.customerCompanyId,
    customerContactId: deal.customerContactId,
  };
}
/** Prisma Decimal text keeps trailing zeros; compare and store canonical. */
const canonical = (amount: string | null) =>
  amount === null
    ? null
    : amount.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

/**
 * Checks deal changes for this board and returns the values to store. On
 * create, `current` is null and the stage defaults to the pipeline's.
 */
export async function prepareDeal(
  tx: DatabaseTransaction,
  board: Board,
  viewer: Viewer,
  changes: Record<string, unknown>,
  current: Loaded | null,
) {
  const pipeline = await pipelineOf(tx, board);
  if (!pipeline) {
    if (touches(changes)) throw notAvailable();
    return null;
  }
  const { deal } = splitDeal(changes);
  const before = current ? dealSnapshot(current) : null;
  const stage = (id: string) => {
    const found = pipeline.stages.find((item) => item.id === id);
    if (!found)
      throw new SetupError(
        422,
        "INVALID_STAGE",
        "Choose a current stage from this pipeline.",
      );
    return found;
  };
  const stageId =
    (deal.stageId as string | undefined) ??
    before?.stageId ??
    pipeline.defaultStageId!;
  const target = stage(stageId);
  const source = before?.stageId ? stage(before.stageId) : null;
  const from = source ? (source.category as StageCategory) : null;
  const to = target.category as StageCategory;
  if (
    source?.id !== target.id &&
    needsStageReason(from, to) &&
    !deal.stageReason
  )
    throw new SetupError(
      422,
      "STAGE_REASON_REQUIRED",
      `Say why this deal is moving from ${from === "WON" ? "Won to Lost" : "Lost to Won"}.`,
    );
  if (deal.customerCompanyId && deal.customerContactId)
    throw new SetupError(
      422,
      "ONE_CUSTOMER",
      "A deal has one customer: a company or a person.",
    );
  let customerCompanyId = before?.customerCompanyId ?? null;
  let customerContactId = before?.customerContactId ?? null;
  // Choosing one kind of customer replaces the other.
  if (deal.customerCompanyId !== undefined) {
    customerCompanyId = deal.customerCompanyId as string | null;
    if (customerCompanyId) customerContactId = null;
  }
  if (deal.customerContactId !== undefined) {
    customerContactId = deal.customerContactId as string | null;
    if (customerContactId) customerCompanyId = null;
  }
  for (const [id, type] of [
    [deal.customerCompanyId, "COMPANY"],
    [deal.customerContactId, "CONTACT"],
  ] as const) {
    if (
      typeof id !== "string" ||
      id ===
        before?.[type === "COMPANY" ? "customerCompanyId" : "customerContactId"]
    )
      continue;
    const customer = await tx.task.findFirst({
      where: {
        id,
        parentId: null,
        deletedAt: null,
        board: {
          recordType: type,
          workspaceId: board.workspaceId,
          ...boardScope(viewer),
        },
      },
      select: { archivedAt: true },
    });
    if (!customer)
      throw new SetupError(
        422,
        "INVALID_CUSTOMER",
        `Choose a ${type === "COMPANY" ? "company" : "contact"} from this workspace that you can see.`,
      );
    if (customer.archivedAt)
      throw new SetupError(
        422,
        "INVALID_CUSTOMER",
        `This ${type === "COMPANY" ? "company" : "contact"} is archived. Restore it first.`,
      );
  }
  const amount =
    deal.amount !== undefined
      ? (deal.amount as string | null)
      : canonical(before?.amount ?? null);
  let currency =
    deal.currency !== undefined
      ? (deal.currency as string | null)
      : (before?.currency ?? null);
  // An amount always has a currency: the installation's unless chosen.
  if (amount !== null && !currency)
    currency =
      (
        await tx.installationSettings.findUnique({
          where: { id: "installation" },
          select: { currency: true },
        })
      )?.currency ?? "PHP";
  const values: DealValues = {
    stageId,
    amount,
    currency,
    customerCompanyId,
    customerContactId,
  };
  return {
    pipeline,
    values,
    moved: source?.id !== target.id,
    source,
    target,
    reason: deal.stageReason ?? null,
  };
}
type Prepared = NonNullable<Awaited<ReturnType<typeof prepareDeal>>>;

/** Was a stage change asked for (as opposed to other deal fields)? */
export const movesStage = (changes: Record<string, unknown>, current: Loaded) =>
  typeof changes.stageId === "string" &&
  changes.stageId !== current.dealProfile?.stageId;

async function recordStage(
  tx: DatabaseTransaction,
  dealId: string,
  actorId: string,
  prepared: Prepared,
) {
  const { source, target, values } = prepared;
  await tx.dealStageEvent.create({
    data: {
      dealId,
      kind: stageTransition(
        source ? (source.category as StageCategory) : null,
        target.category as StageCategory,
      ),
      fromStageId: source?.id ?? null,
      fromStageName: source?.name ?? null,
      fromCategory: source?.category ?? null,
      toStageId: target.id,
      toStageName: target.name,
      toCategory: target.category,
      amount: values.amount,
      currency: values.currency,
      reason: prepared.reason,
      actorId,
    },
  });
}
/** Closure follows the category: entering Won/Lost sets it, reopening
 *  clears it, moving within a closed category keeps it. */
function closedAt(prepared: Prepared, previous: Date | null) {
  const to = prepared.target.category as StageCategory;
  const from = prepared.source
    ? (prepared.source.category as StageCategory)
    : null;
  if (to === "OPEN") return null;
  return from === to && previous ? previous : new Date();
}

export async function createDeal(
  tx: DatabaseTransaction,
  recordId: string,
  board: Board,
  actorId: string,
  prepared: Prepared | null,
) {
  if (!prepared) return;
  await tx.dealProfile.create({
    data: {
      recordId,
      workspaceId: board.workspaceId,
      boardId: board.id,
      ...prepared.values,
      closedAt: closedAt(prepared, null),
    },
  });
  await recordStage(tx, recordId, actorId, prepared);
}

export async function updateDeal(
  tx: DatabaseTransaction,
  task: Loaded,
  actorId: string,
  prepared: Prepared | null,
) {
  if (!prepared || !task.dealProfile) return;
  const before = dealSnapshot(task);
  const changed = (Object.keys(prepared.values) as DealKey[]).some(
    (key) =>
      (key === "amount" ? canonical(before.amount ?? null) : before[key]) !==
      prepared.values[key],
  );
  if (!changed) return;
  await tx.dealProfile.update({
    where: { recordId: task.id },
    data: {
      ...prepared.values,
      ...(prepared.moved
        ? { closedAt: closedAt(prepared, task.dealProfile.closedAt) }
        : {}),
    },
  });
  if (prepared.moved) await recordStage(tx, task.id, actorId, prepared);
}

/** Option A for stages: no stage moves while the pipeline needs approvals. */
export function stageApprovalBlocked() {
  return new SetupError(
    409,
    "DEAL_STAGE_APPROVAL_UNSUPPORTED",
    "Moving deals between stages is paused here: this pipeline has approvals turned on, and approval for stage changes isn't available yet. Other deal fields still follow the approval rules.",
  );
}
