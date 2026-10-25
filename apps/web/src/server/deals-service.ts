import {
  getDatabase,
  type DatabaseTransaction,
  type Prisma,
} from "@yuzu/database";
import { z } from "zod";
import { recordId } from "@/lib/id-contract";
import { escapeLike } from "@/lib/board-query";
import type { StageCategory } from "@/lib/deal-contract";
import { access, canEdit, eligiblePeople, taskInclude } from "./board-service";
import { dealSnapshot } from "./deal-profile";
import { SetupError } from "./setup/security";
import { boardScope, requireIdentity } from "./team-access";

/** Reads for CRM pipeline Deals: board lanes, the table and one record. */
type Viewer = { id: string; role: string };
type Loaded = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;
export const DEAL_LANE_SIZE = 50;
export const DEAL_PAGE_SIZE = 50;

const unavailable = () =>
  new SetupError(404, "NOT_FOUND", "This pipeline is not available to you.");
const customerSchema = z
  .discriminatedUnion("visible", [
    z.object({
      visible: z.literal(true),
      type: z.enum(["COMPANY", "CONTACT"]),
      id: recordId,
      name: z.string(),
      archived: z.boolean(),
    }),
    z.object({
      visible: z.literal(false),
      type: z.enum(["COMPANY", "CONTACT"]),
    }),
  ])
  .nullable();
export const dealSchema = z.object({
  id: recordId,
  name: z.string(),
  description: z.string(),
  ownerId: z.string().nullable(),
  expectedCloseDate: z.string().nullable(),
  stageId: recordId,
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  customer: customerSchema,
  closedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  revision: z.number().int().positive(),
  position: z.number(),
  canEdit: z.boolean(),
  commentCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
});
export type Deal = z.infer<typeof dealSchema>;

const dealQuerySchema = z
  .object({
    boardId: recordId,
    q: z.string().trim().max(200).default(""),
    archived: z.boolean().default(false),
    stageId: recordId.optional(),
    sort: z
      .enum(["position", "name", "-amount", "close", "-created"])
      .default("position"),
    page: z.number().int().min(1).max(10_000).default(1),
  })
  .strict();

/** Customer names the viewer may see; others stay private. */
async function customers(
  tx: DatabaseTransaction,
  viewer: Viewer,
  workspaceId: string,
  tasks: Loaded[],
) {
  const ids = tasks.flatMap((task) =>
    [
      task.dealProfile?.customerCompanyId,
      task.dealProfile?.customerContactId,
    ].filter((id): id is string => Boolean(id)),
  );
  const visible = await tx.task.findMany({
    where: {
      id: { in: ids },
      deletedAt: null,
      board: { workspaceId, ...boardScope(viewer) },
    },
    select: { id: true, name: true, archivedAt: true },
  });
  return new Map(visible.map((item) => [item.id, item]));
}
function dealView(
  task: Loaded,
  context: Awaited<ReturnType<typeof access>>,
  known: Awaited<ReturnType<typeof customers>>,
): Deal {
  const values = dealSnapshot(task);
  const customerId = values.customerCompanyId ?? values.customerContactId;
  const type = values.customerCompanyId ? "COMPANY" : "CONTACT";
  const customer = customerId ? known.get(customerId) : null;
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    ownerId: task.assignees[0]?.userId ?? null,
    expectedCloseDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
    stageId: values.stageId!,
    amount: values.amount ?? null,
    currency: values.currency ?? null,
    customer: !customerId
      ? null
      : customer
        ? {
            visible: true,
            type,
            id: customer.id,
            name: customer.name,
            archived: Boolean(customer.archivedAt),
          }
        : { visible: false, type },
    closedAt: task.dealProfile?.closedAt?.toISOString() ?? null,
    archivedAt: task.archivedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    revision: task.revision,
    position: task.position,
    canEdit: canEdit(task, context) && !task.archivedAt,
    commentCount: task._count.comments,
    attachmentCount: task._count.attachments,
  };
}

async function pipelineContext(
  tx: DatabaseTransaction,
  viewer: Viewer,
  boardId: string,
) {
  const context = await access(tx, viewer.id, boardId);
  const pipeline = await tx.pipeline.findUnique({
    where: { boardId },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  if (!pipeline) throw unavailable();
  return { context, pipeline };
}
const searchWhere = (q: string): Prisma.TaskWhereInput =>
  q ? { name: { contains: escapeLike(q), mode: "insensitive" } } : {};

/** Board lanes: the first deals of each stage, with whole-stage counts. */
export async function dealLanes(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return dealLanesFor(user, input);
}
export async function dealLanesFor(viewer: Viewer, input: unknown) {
  const query = dealQuerySchema.parse(input);
  return getDatabase().$transaction(async (tx) => {
    const { context, pipeline } = await pipelineContext(
      tx,
      viewer,
      query.boardId,
    );
    const base: Prisma.TaskWhereInput = {
      boardId: query.boardId,
      parentId: null,
      deletedAt: null,
      archivedAt: query.archived ? { not: null } : null,
      ...searchWhere(query.q),
    };
    const lanes = await Promise.all(
      pipeline.stages.map(async (stage) => {
        const where = { ...base, dealProfile: { stageId: stage.id } };
        const [total, tasks] = await Promise.all([
          tx.task.count({ where }),
          tx.task.findMany({
            where,
            include: taskInclude,
            orderBy: [{ position: "asc" }, { id: "asc" }],
            take: DEAL_LANE_SIZE,
          }),
        ]);
        return { stageId: stage.id, total, tasks };
      }),
    );
    const known = await customers(
      tx,
      viewer,
      context.board.workspaceId,
      lanes.flatMap((lane) => lane.tasks),
    );
    return {
      boardId: query.boardId,
      people: await eligiblePeople(tx, context.board),
      lanes: lanes.map((lane) => ({
        stageId: lane.stageId,
        total: lane.total,
        deals: lane.tasks.map((task) => dealView(task, context, known)),
      })),
    };
  });
}

/** One page of a pipeline's deals for the table; totals cover the filter. */
export async function dealList(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return dealListFor(user, input);
}
export async function dealListFor(viewer: Viewer, input: unknown) {
  const query = dealQuerySchema.parse(input);
  return getDatabase().$transaction(async (tx) => {
    const { context } = await pipelineContext(tx, viewer, query.boardId);
    const where: Prisma.TaskWhereInput = {
      boardId: query.boardId,
      parentId: null,
      deletedAt: null,
      archivedAt: query.archived ? { not: null } : null,
      ...searchWhere(query.q),
      ...(query.stageId ? { dealProfile: { stageId: query.stageId } } : {}),
    };
    const total = await tx.task.count({ where });
    const pageCount = Math.ceil(total / DEAL_PAGE_SIZE);
    const page = Math.min(query.page, Math.max(pageCount, 1));
    const orderBy: Prisma.TaskOrderByWithRelationInput[] =
      query.sort === "name"
        ? [{ name: "asc" }, { id: "asc" }]
        : query.sort === "-amount"
          ? [
              { dealProfile: { amount: { sort: "desc", nulls: "last" } } },
              { id: "asc" },
            ]
          : query.sort === "close"
            ? [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }]
            : query.sort === "-created"
              ? [{ createdAt: "desc" }, { id: "desc" }]
              : [{ position: "asc" }, { id: "asc" }];
    const tasks = await tx.task.findMany({
      where,
      include: taskInclude,
      orderBy,
      skip: (page - 1) * DEAL_PAGE_SIZE,
      take: DEAL_PAGE_SIZE,
    });
    const known = await customers(tx, viewer, context.board.workspaceId, tasks);
    return {
      boardId: query.boardId,
      people: await eligiblePeople(tx, context.board),
      deals: tasks.map((task) => dealView(task, context, known)),
      page,
      pageCount,
      total,
    };
  });
}

/** One deal with its stage history, newest first. */
export async function dealRecord(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return dealRecordFor(user, input);
}
export async function dealRecordFor(viewer: Viewer, input: unknown) {
  const id = recordId.parse((input as { recordId?: unknown })?.recordId);
  return getDatabase().$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: {
        id,
        parentId: null,
        deletedAt: null,
        dealProfile: { isNot: null },
      },
      include: taskInclude,
    });
    if (!task)
      throw new SetupError(
        404,
        "NOT_FOUND",
        "This deal is not available to you.",
      );
    const context = await access(tx, viewer.id, task.boardId);
    const known = await customers(tx, viewer, context.board.workspaceId, [
      task,
    ]);
    const history = await tx.dealStageEvent.findMany({
      where: { dealId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const people = new Map(
      (await eligiblePeople(tx, context.board)).map((person) => [
        person.id,
        person.name,
      ]),
    );
    return {
      boardId: task.boardId,
      deal: dealView(task, context, known),
      history: history.map((event) => ({
        id: event.id,
        kind: event.kind,
        from: event.fromStageName,
        fromCategory: event.fromCategory as StageCategory | null,
        to: event.toStageName,
        toCategory: event.toCategory as StageCategory,
        amount: event.amount?.toString() ?? null,
        currency: event.currency,
        reason: event.reason,
        actor: people.get(event.actorId) ?? "Former teammate",
        createdAt: event.createdAt.toISOString(),
      })),
    };
  });
}

/** Deals a Company or Contact is the customer of, that the viewer can see. */
export async function customerDeals(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return customerDealsFor(user, input);
}
export async function customerDealsFor(viewer: Viewer, input: unknown) {
  const id = recordId.parse((input as { recordId?: unknown })?.recordId);
  return getDatabase().$transaction(async (tx) => {
    const customer = await tx.task.findFirst({
      where: { id, deletedAt: null, board: { ...boardScope(viewer) } },
      select: { board: { select: { workspaceId: true } } },
    });
    if (!customer)
      throw new SetupError(
        404,
        "NOT_FOUND",
        "This record is not available to you.",
      );
    const deals = await tx.dealProfile.findMany({
      where: {
        OR: [{ customerCompanyId: id }, { customerContactId: id }],
        record: { deletedAt: null, board: { ...boardScope(viewer) } },
      },
      orderBy: [
        { closedAt: { sort: "asc", nulls: "first" } },
        { recordId: "desc" },
      ],
      take: 50,
      select: {
        recordId: true,
        amount: true,
        currency: true,
        closedAt: true,
        stage: { select: { name: true, category: true } },
        record: {
          select: {
            name: true,
            archivedAt: true,
            board: { select: { id: true, name: true } },
          },
        },
      },
    });
    return deals.map((deal) => ({
      id: deal.recordId,
      name: deal.record.name,
      pipelineId: deal.record.board.id,
      pipeline: deal.record.board.name,
      stage: deal.stage.name,
      category: deal.stage.category as StageCategory,
      amount: deal.amount?.toString() ?? null,
      currency: deal.currency,
      archived: Boolean(deal.record.archivedAt),
    }));
  });
}
