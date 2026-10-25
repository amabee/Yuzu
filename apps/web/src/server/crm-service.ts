import {
  getDatabase,
  type DatabaseTransaction,
  type Prisma,
} from "@yuzu/database";
import { z } from "zod";
import {
  CRM_MATCH_LIMIT,
  CRM_PAGE_SIZE,
  crmDirectoryQuerySchema,
  crmMatchQuerySchema,
  normalizeDomain,
  profileFields,
  profileKeysFor,
  profileLabel,
  type CrmDirectory,
  type CrmMatches,
  type CrmRecord,
  type CrmRecordDetail,
  type ProfileKey,
} from "@/lib/crm-contract";
import { recordId } from "@/lib/id-contract";
import { escapeLike } from "@/lib/board-query";
import {
  builtinName,
  resolveRecordConfig,
  type CrmRecordType,
} from "@/lib/record-types";
import { readApprovalPolicy } from "./approval-policy";
import { access, canEdit, eligiblePeople, taskInclude } from "./board-service";
import { profileSnapshot } from "./crm-profile";
import { SetupError } from "./setup/security";
import { gatedAccess } from "./api-gate";
import { requireIdentity, workspaceScope } from "./team-access";

/**
 * The CRM module's Companies and Contacts (docs/specs/companies-contacts.md).
 * Each workspace has one collection of each: a standalone board of that type,
 * created the first time someone opens it. Records are shared records on that
 * board, so create, update, archive, comments, files, approvals, Trash and
 * realtime go through the same paths as every other record.
 */
const db = getDatabase;
const unavailable = () =>
  new SetupError(404, "NOT_FOUND", "This workspace is not available to you.");
const crmType = z.enum(["COMPANY", "CONTACT"]);

/** Columns of a collection board. Profile columns adapt the profile values
 *  so approvals and labels can refer to them; they hold no field values. */
function collectionColumns(type: CrmRecordType) {
  const record = resolveRecordConfig(type, {});
  return [
    { key: "name", name: record.singular, type: "TEXT", position: 0 },
    {
      key: "assignees",
      name: builtinName(record, "assignees"),
      type: "PEOPLE",
      position: 1,
    },
    {
      key: "description",
      name: builtinName(record, "description"),
      type: "LONG_TEXT",
      position: 2,
    },
    ...profileKeysFor[type].map((key, index) => ({
      key: profileFields[key].column,
      name: profileLabel(type, key),
      type: profileFields[key].type,
      position: 3 + index,
      config: { system: true },
    })),
  ];
}

/** The workspace's collection of this type, if it exists yet. Only full
 *  workspace members (and administrators) reach CRM collections. */
async function findCollection(
  tx: DatabaseTransaction,
  user: { id: string; role: string },
  workspaceId: string,
  type: CrmRecordType,
) {
  const workspace = await tx.workspace.findFirst({
    where: { id: workspaceId, ...workspaceScope(user) },
    select: { id: true },
  });
  if (!workspace) throw unavailable();
  return tx.board.findFirst({
    where: { workspaceId, recordType: type },
    select: { id: true, deletedAt: true },
  });
}

/**
 * Opens (and on first use creates) the workspace's collection. Two people
 * opening it at once can't create two: the database allows one per type.
 */
export async function crmCollection(
  user: { id: string; role: string },
  workspaceId: string,
  type: CrmRecordType,
  /** Read-only API tokens see existing collections but never create one. */
  provision = true,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const existing = await db().$transaction((tx) =>
      findCollection(tx, user, workspaceId, type),
    );
    if (existing) {
      if (existing.deletedAt) throw unavailable();
      return existing.id;
    }
    if (!provision)
      throw new SetupError(
        404,
        "NOT_SET_UP",
        "This workspace has no Companies or Contacts yet. Open CRM in Yuzu once to set them up.",
      );
    try {
      return await db().$transaction(async (tx) => {
        const settings = await tx.installationSettings.findUnique({
          where: { id: "installation" },
        });
        if (settings?.maintenanceMode)
          throw new SetupError(
            503,
            "MAINTENANCE",
            "Changes are paused during maintenance.",
          );
        const record = resolveRecordConfig(type, {});
        const board = await tx.board.create({
          data: {
            workspaceId,
            name: record.plural,
            createdById: user.id,
            recordType: type,
            recordConfig: record,
            columns: { create: collectionColumns(type) },
            groups: { create: { name: record.plural, position: 0 } },
          },
          select: { id: true },
        });
        await tx.boardEvent.create({
          data: {
            boardId: board.id,
            actorId: user.id,
            action: `Created the ${record.plural} collection`,
          },
        });
        return board.id;
      });
    } catch (error) {
      // Someone else created it first; use theirs.
      if (attempt < 2 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}
const isUniqueViolation = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002",
  );

type LoadedRecord = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;
function recordView(
  task: LoadedRecord,
  type: CrmRecordType,
  context: Awaited<ReturnType<typeof access>>,
): CrmRecord {
  const profile = profileSnapshot(task, type);
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    ownerId: task.assignees[0]?.userId ?? null,
    createdById: task.createdById,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    archivedAt: task.archivedAt?.toISOString() ?? null,
    revision: task.revision,
    canEdit: canEdit(task, context) && !task.archivedAt,
    commentCount: task._count.comments,
    attachmentCount: task._count.attachments,
    profile: Object.fromEntries(
      (Object.keys(profileFields) as ProfileKey[]).map((key) => [
        key,
        profile[key] ?? null,
      ]),
    ) as CrmRecord["profile"],
  };
}

/** Search: name for everyone, plus email and domain where the type has them. */
function searchWhere(type: CrmRecordType, q: string): Prisma.TaskWhereInput {
  if (!q) return {};
  const contains = { contains: escapeLike(q), mode: "insensitive" as const };
  return {
    OR: [
      { name: contains },
      type === "COMPANY"
        ? {
            companyProfile: {
              OR: [{ domain: contains }, { email: contains }],
            },
          }
        : { contactProfile: { email: contains } },
    ],
  };
}
const orderFor = (sort: string): Prisma.TaskOrderByWithRelationInput[] =>
  sort === "-name"
    ? [{ name: "desc" }, { id: "desc" }]
    : sort === "created"
      ? [{ createdAt: "asc" }, { id: "asc" }]
      : sort === "-created"
        ? [{ createdAt: "desc" }, { id: "desc" }]
        : [{ name: "asc" }, { id: "asc" }];

/** One page of a collection. Totals cover the whole collection, not the page. */
export async function crmDirectory(
  input: unknown,
  workspaceId: string,
  headers: Headers,
): Promise<CrmDirectory> {
  const { user, viaToken } = await requireIdentity(headers);
  return crmDirectoryFor(
    user,
    input,
    workspaceId,
    !viaToken || gatedAccess(headers) === "write",
  );
}
export async function crmDirectoryFor(
  user: { id: string; role: string },
  input: unknown,
  workspaceId: string,
  provision = true,
): Promise<CrmDirectory> {
  const query = crmDirectoryQuerySchema.parse(input);
  const boardId = await crmCollection(
    user,
    recordId.parse(workspaceId),
    query.type,
    provision,
  );
  return db().$transaction(async (tx) => {
    const context = await access(tx, user.id, boardId);
    const base: Prisma.TaskWhereInput = {
      boardId,
      parentId: null,
      deletedAt: null,
    };
    const where: Prisma.TaskWhereInput = {
      ...base,
      archivedAt: query.archived ? { not: null } : null,
      ...searchWhere(query.type, query.q),
    };
    const [total, liveTotal] = await Promise.all([
      tx.task.count({ where }),
      tx.task.count({ where: { ...base, archivedAt: null } }),
    ]);
    const pageCount = Math.ceil(total / CRM_PAGE_SIZE);
    const page = Math.min(query.page, Math.max(pageCount, 1));
    const tasks = await tx.task.findMany({
      where,
      include: taskInclude,
      orderBy: orderFor(query.sort),
      skip: (page - 1) * CRM_PAGE_SIZE,
      take: CRM_PAGE_SIZE,
    });
    const policy = await readApprovalPolicy(tx, context.board);
    return {
      type: query.type,
      boardId,
      workspaceId: context.board.workspaceId,
      currentUserId: user.id,
      canCreate: !context.readOnly,
      canManage: context.canManage,
      approvals: policy.enabled,
      people: await eligiblePeople(tx, context.board),
      records: tasks.map((task) => recordView(task, query.type, context)),
      page,
      pageCount,
      total,
      liveTotal,
    };
  });
}

/** Snapshot keys that activity reports by name, beyond profile fields. */
const sharedLabels: Record<string, string> = {
  name: "Name",
  description: "Notes",
  assigneeIds: "Owner",
};
function describe(value: unknown, people: Map<string, string>) {
  if (value == null || value === "") return null;
  if (Array.isArray(value))
    return value.length
      ? value
          .map((id) => people.get(String(id)) ?? "Former teammate")
          .join(", ")
      : null;
  return String(value);
}

/** A record for the record card, with what changed in recent activity. */
export async function crmRecord(
  input: unknown,
  headers: Headers,
): Promise<CrmRecordDetail> {
  const { user } = await requireIdentity(headers);
  return crmRecordFor(user, input);
}
export async function crmRecordFor(
  user: { id: string },
  input: unknown,
): Promise<CrmRecordDetail> {
  const id = recordId.parse((input as { recordId?: unknown })?.recordId);
  return db().$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id, parentId: null, deletedAt: null },
      include: taskInclude,
    });
    if (!task)
      throw new SetupError(
        404,
        "NOT_FOUND",
        "This record is not available to you.",
      );
    const context = await access(tx, user.id, task.boardId);
    const type = crmType.safeParse(context.board.recordType);
    if (!type.success)
      throw new SetupError(
        404,
        "NOT_FOUND",
        "This record is not available to you.",
      );
    const activity = await tx.taskActivity.findMany({
      where: { taskId: task.id },
      select: {
        id: true,
        action: true,
        createdAt: true,
        before: true,
        after: true,
        actor: { select: { name: true } },
      },
      orderBy: { revision: "desc" },
      take: 50,
    });
    const people = new Map(
      (await eligiblePeople(tx, context.board)).map((person) => [
        person.id,
        person.name,
      ]),
    );
    const labels: Record<string, string> = {
      ...sharedLabels,
      ...Object.fromEntries(
        profileKeysFor[type.data].map((key) => [
          key,
          profileLabel(type.data, key),
        ]),
      ),
    };
    return {
      type: type.data,
      boardId: task.boardId,
      record: recordView(task, type.data, context),
      activity: activity.map((entry) => {
        const before = (entry.before ?? {}) as Record<string, unknown>;
        const after = (entry.after ?? {}) as Record<string, unknown>;
        return {
          id: entry.id,
          action: entry.action,
          actor: entry.actor.name,
          createdAt: entry.createdAt.toISOString(),
          changes: entry.before
            ? Object.keys(labels)
                .filter(
                  (key) =>
                    JSON.stringify(before[key] ?? null) !==
                    JSON.stringify(after[key] ?? null),
                )
                .map((key) => ({
                  field: labels[key]!,
                  from: describe(before[key], people),
                  to: describe(after[key], people),
                }))
            : [],
        };
      }),
    };
  });
}

/**
 * Records that look like the one being added: same email or domain first,
 * then similar names. Only records the person can already see are checked,
 * so suggestions never reveal anything else. They are hints, not rules:
 * people can always add the record anyway, and nothing is merged.
 */
export async function crmMatches(
  input: unknown,
  workspaceId: string,
  headers: Headers,
): Promise<CrmMatches> {
  const { user, viaToken } = await requireIdentity(headers);
  return crmMatchesFor(
    user,
    input,
    workspaceId,
    !viaToken || gatedAccess(headers) === "write",
  );
}
export async function crmMatchesFor(
  user: { id: string; role: string },
  input: unknown,
  workspaceId: string,
  provision = true,
): Promise<CrmMatches> {
  const query = crmMatchQuerySchema.parse(input);
  const boardId = await crmCollection(
    user,
    recordId.parse(workspaceId),
    query.type,
    provision,
  );
  return db().$transaction(async (tx) => {
    await access(tx, user.id, boardId);
    const base: Prisma.TaskWhereInput = {
      boardId,
      parentId: null,
      deletedAt: null,
      ...(query.exclude ? { id: { not: query.exclude } } : {}),
    };
    const email = query.email.toLowerCase();
    const domain = query.domain ? normalizeDomain(query.domain) : null;
    const emailDomain = email.includes("@")
      ? normalizeDomain(email.slice(email.lastIndexOf("@") + 1))
      : null;
    const found = new Map<string, CrmMatches[number]>();
    const add = (tasks: MatchRow[], reason: CrmMatches[number]["reason"]) => {
      for (const task of tasks)
        if (!found.has(task.id) && found.size < CRM_MATCH_LIMIT)
          found.set(task.id, {
            id: task.id,
            name: task.name,
            detail:
              task.companyProfile?.domain ??
              task.companyProfile?.email ??
              task.contactProfile?.email ??
              null,
            archived: Boolean(task.archivedAt),
            reason,
          });
    };
    const select = {
      id: true,
      name: true,
      archivedAt: true,
      companyProfile: { select: { domain: true, email: true } },
      contactProfile: { select: { email: true } },
    } as const;
    type MatchRow = Prisma.TaskGetPayload<{ select: typeof select }>;
    const take = CRM_MATCH_LIMIT;
    if (email)
      add(
        await tx.task.findMany({
          where: {
            ...base,
            ...(query.type === "COMPANY"
              ? { companyProfile: { emailKey: email } }
              : { contactProfile: { emailKey: email } }),
          },
          select,
          take,
        }),
        "EMAIL",
      );
    const domains = [
      domain,
      query.type === "COMPANY" ? emailDomain : null,
    ].filter((value): value is string => Boolean(value));
    if (domains.length && query.type === "COMPANY")
      add(
        await tx.task.findMany({
          where: {
            ...base,
            // Same domain, or a main email at that domain.
            companyProfile: {
              OR: [
                { domain: { in: domains } },
                ...domains.map((domain) => ({
                  emailKey: { endsWith: `@${domain}` },
                })),
              ],
            },
          },
          select,
          take,
        }),
        "DOMAIN",
      );
    if (query.name.trim().length >= 2) {
      // Similar, not just containing: "Northwind Corp" finds "Northwind Trading".
      const similar = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Task"
        WHERE "boardId" = ${boardId} AND "parentId" IS NULL AND "deletedAt" IS NULL
          AND "id" <> ${query.exclude ?? ""}
          AND ("name" ILIKE ${`%${escapeLike(query.name)}%`}
            OR similarity(lower("name"), lower(${query.name})) > 0.3)
        ORDER BY similarity(lower("name"), lower(${query.name})) DESC, "name", "id"
        LIMIT ${take}`;
      const rows = await tx.task.findMany({
        where: { id: { in: similar.map((row) => row.id) } },
        select,
      });
      add(
        similar
          .map((row) => rows.find((task) => task.id === row.id))
          .filter((task): task is MatchRow => Boolean(task)),
        "NAME",
      );
    }
    return [...found.values()];
  });
}
