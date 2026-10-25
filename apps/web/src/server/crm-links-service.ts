import {
  createRecordId,
  getDatabase,
  type DatabaseTransaction,
  type Prisma,
} from "@yuzu/database";
import {
  LINK_PAGE_SIZE,
  MAX_COMPANY_LINKS,
  crmLinksQuerySchema,
  linkCreateSchema,
  linkPrimarySchema,
  linkRemoveSchema,
  linkUpdateSchema,
  type CrmLink,
  type CrmLinks,
  type LinkResult,
} from "@/lib/crm-contract";
import { stableJson } from "@/lib/approval-rules";
import { readApprovalPolicy } from "./approval-policy";
import { access, canEdit, serial, taskInclude } from "./board-service";
import { digest, SetupError } from "./setup/security";
import { boardScope, requireIdentity } from "./team-access";

/**
 * Contact–Company links (docs/specs/companies-contacts.md, slice 1b). The
 * contact owns each link: changing one takes edit access to the contact and
 * sight of the company. Link changes never touch either record's own
 * revision; each link has its own, and the contact's primary choice has a
 * separate primaryRevision. Every change locks the contact's profile row, so
 * the 100-link cap and the single primary hold under concurrency.
 */
const unavailable = () =>
  new SetupError(404, "NOT_FOUND", "This record is not available to you.");
const restricted = () =>
  new SetupError(
    409,
    "RESTRICTED_LINKS",
    "Some of this contact's links involve records you can't see. Ask an administrator to help change them.",
  );
const approvalBlocked =
  "Linking is paused here: the Contacts board has approvals turned on, and approval for company links isn't available yet. Existing links stay visible.";

type Viewer = { id: string; role: string };
type Loaded = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/** The contact, with the viewer's access to its board. */
async function contactFor(
  tx: DatabaseTransaction,
  userId: string,
  contactId: string,
  write: boolean,
) {
  const task = await tx.task.findFirst({
    where: { id: contactId, parentId: null, deletedAt: null },
    include: taskInclude,
  });
  if (!task) throw unavailable();
  const context = await access(tx, userId, task.boardId, write);
  if (context.board.recordType !== "CONTACT") throw unavailable();
  return { task, context };
}
/** A record of this type the viewer can see in the workspace, or null. */
function visibleRecord(
  tx: DatabaseTransaction,
  viewer: Viewer,
  id: string,
  type: "COMPANY" | "CONTACT",
  workspaceId: string,
) {
  return tx.task.findFirst({
    where: {
      id,
      parentId: null,
      deletedAt: null,
      board: { recordType: type, workspaceId, ...boardScope(viewer) },
    },
    include: taskInclude,
  });
}

/** May the viewer change this contact's links right now? Throws why not. */
async function authorize(
  tx: DatabaseTransaction,
  contact: Awaited<ReturnType<typeof contactFor>>,
) {
  const { task, context } = contact;
  if (!canEdit(task, context))
    throw new SetupError(
      403,
      "FORBIDDEN",
      "Only this contact's owner, creator, editors and managers can change its companies.",
    );
  if (task.archivedAt)
    throw new SetupError(
      409,
      "RECORD_ARCHIVED",
      "This contact is archived. Restore it to change its companies.",
    );
  // Option A: no link changes at all while the Contacts board needs
  // approvals, for anyone. Read inside this transaction, so a policy change
  // racing this command serializes with it.
  if ((await readApprovalPolicy(tx, context.board)).enabled)
    throw new SetupError(
      409,
      "AFFILIATION_APPROVAL_UNSUPPORTED",
      approvalBlocked,
    );
}
function liveCompany(company: Loaded | null) {
  if (!company) throw unavailable();
  if (company.archivedAt)
    throw new SetupError(
      409,
      "RECORD_ARCHIVED",
      "This company is archived. Restore it to change its links.",
    );
  return company;
}
const lockContact = (tx: DatabaseTransaction, contactId: string) =>
  tx.$queryRaw`SELECT 1 FROM "ContactProfile" WHERE "recordId" = ${contactId} FOR UPDATE`;

/** Persisted replay: same key and payload → same result; changed payload → conflict. */
async function replayed(
  tx: DatabaseTransaction,
  actorId: string,
  requestKey: string,
  requestDigest: string,
) {
  const saved = await tx.affiliationRequest.findUnique({
    where: { actorId_requestKey: { actorId, requestKey } },
  });
  if (!saved) return null;
  if (saved.digest !== requestDigest)
    throw new SetupError(
      409,
      "RETRY_CHANGED",
      "This request key already belongs to a different change.",
    );
  return saved.result as LinkResult;
}
async function remember(
  tx: DatabaseTransaction,
  actorId: string,
  requestKey: string,
  requestDigest: string,
  result: LinkResult,
) {
  await tx.affiliationRequest.create({
    data: { actorId, requestKey, digest: requestDigest, result },
  });
  return result;
}

/** One line on each record's activity, without changing their revisions. */
async function logLink(
  tx: DatabaseTransaction,
  actorId: string,
  contact: { id: string; boardId: string },
  company: { id: string; boardId: string },
  action: "Linked" | "Changed link" | "Unlinked" | "Primary company",
  details: Record<string, unknown>,
) {
  const after = { contactId: contact.id, companyId: company.id, ...details };
  await tx.boardEvent.createMany({
    data: [
      {
        id: createRecordId(),
        boardId: contact.boardId,
        actorId,
        action: action === "Primary company" ? action : `${action} company`,
        subjectId: contact.id,
        after,
      },
      {
        id: createRecordId(),
        boardId: company.boardId,
        actorId,
        action:
          action === "Primary company"
            ? "Primary company"
            : `${action} contact`,
        subjectId: company.id,
        after,
      },
    ],
  });
}

const resultOf = (
  outcome: LinkResult["outcome"],
  values: Omit<LinkResult, "outcome">,
): LinkResult => ({ outcome, ...values });

export async function linkCompany(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return serial((tx) => linkCompanyInTransaction(tx, input, user));
}
export async function linkCompanyInTransaction(
  tx: DatabaseTransaction,
  input: unknown,
  viewer: Viewer,
): Promise<LinkResult> {
  const body = linkCreateSchema.parse(input);
  const requestDigest = digest(stableJson({ action: "link", ...body }));
  const prior = await replayed(tx, viewer.id, body.requestKey, requestDigest);
  if (prior) {
    // A replay only returns a link the viewer can still see.
    const link = prior.linkId
      ? await tx.contactCompany.findUnique({ where: { id: prior.linkId } })
      : null;
    if (
      !link ||
      !(await visibleRecord(
        tx,
        viewer,
        link.companyId,
        "COMPANY",
        link.workspaceId,
      ))
    )
      throw unavailable();
    return prior;
  }
  const contact = await contactFor(tx, viewer.id, body.contactId, true);
  await authorize(tx, contact);
  const workspaceId = contact.context.board.workspaceId;
  const company = liveCompany(
    await visibleRecord(tx, viewer, body.companyId, "COMPANY", workspaceId),
  );
  await lockContact(tx, body.contactId);
  const profile = await tx.contactProfile.findUniqueOrThrow({
    where: { recordId: body.contactId },
  });
  const base = {
    contactId: body.contactId,
    companyId: body.companyId,
    contactBoardId: contact.task.boardId,
    companyBoardId: company.boardId,
    primaryRevision: profile.primaryRevision,
  };
  // An existing pair is returned as it is, even at the cap and even if Former.
  const existing = await tx.contactCompany.findUnique({
    where: {
      contactId_companyId: {
        contactId: body.contactId,
        companyId: body.companyId,
      },
    },
  });
  if (existing)
    return remember(
      tx,
      viewer.id,
      body.requestKey,
      requestDigest,
      resultOf("ALREADY_LINKED", {
        ...base,
        linkId: existing.id,
        revision: existing.revision,
      }),
    );
  const links = await tx.contactCompany.findMany({
    where: { contactId: body.contactId },
    select: { companyId: true },
  });
  if (links.length >= MAX_COMPANY_LINKS) {
    const seen = await tx.task.count({
      where: {
        id: { in: links.map((link) => link.companyId) },
        deletedAt: null,
        board: { ...boardScope(viewer) },
      },
    });
    // Hidden links count too, but are never described.
    if (seen < links.length) throw restricted();
    throw new SetupError(
      409,
      "TOO_MANY_LINKS",
      `A contact can be linked to at most ${MAX_COMPANY_LINKS} companies. Remove one first.`,
    );
  }
  const link = await tx.contactCompany.create({
    data: {
      workspaceId,
      contactId: body.contactId,
      companyId: body.companyId,
      role: body.role ?? null,
      status: body.status,
      createdById: viewer.id,
      updatedById: viewer.id,
    },
  });
  await logLink(tx, viewer.id, contact.task, company, "Linked", {
    role: link.role,
    status: link.status,
  });
  return remember(
    tx,
    viewer.id,
    body.requestKey,
    requestDigest,
    resultOf("LINKED", { ...base, linkId: link.id, revision: link.revision }),
  );
}

/** A link and both of its records, checked for a change by the viewer. */
async function editableLink(
  tx: DatabaseTransaction,
  viewer: Viewer,
  linkId: string,
) {
  const link = await tx.contactCompany.findUnique({ where: { id: linkId } });
  if (!link) throw unavailable();
  const contact = await contactFor(tx, viewer.id, link.contactId, true);
  // Links to companies the viewer can't see can't be changed by guessing ids.
  const company = await visibleRecord(
    tx,
    viewer,
    link.companyId,
    "COMPANY",
    link.workspaceId,
  );
  if (!company) throw unavailable();
  await authorize(tx, contact);
  liveCompany(company);
  await lockContact(tx, link.contactId);
  // Re-read under the lock.
  const locked = await tx.contactCompany.findUnique({ where: { id: linkId } });
  if (!locked) throw unavailable();
  const profile = await tx.contactProfile.findUniqueOrThrow({
    where: { recordId: link.contactId },
  });
  return { link: locked, contact, company, profile };
}
const linkChanged = () =>
  new SetupError(
    409,
    "LINK_CHANGED",
    "This link changed since you opened it. The latest version is showing now.",
  );
const primaryChanged = () =>
  new SetupError(
    409,
    "PRIMARY_CHANGED",
    "The primary company changed since you opened this contact. Check it and try again.",
  );
/** Changing the current primary needs the primary token and a clear intent. */
function checkPrimaryClear(
  clearPrimary: boolean,
  primaryRevision: number | undefined,
  current: number,
) {
  if (!clearPrimary)
    throw new SetupError(
      422,
      "PRIMARY_INVOLVED",
      "This is the contact's primary company. Choose to clear it as primary too.",
    );
  if (primaryRevision !== current) throw primaryChanged();
}

export async function updateLink(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return serial((tx) => updateLinkInTransaction(tx, input, user));
}
export async function updateLinkInTransaction(
  tx: DatabaseTransaction,
  input: unknown,
  viewer: Viewer,
): Promise<LinkResult> {
  const body = linkUpdateSchema.parse(input);
  const requestDigest = digest(stableJson({ action: "update", ...body }));
  const prior = await replayed(tx, viewer.id, body.requestKey, requestDigest);
  if (prior) return prior;
  const { link, contact, company, profile } = await editableLink(
    tx,
    viewer,
    body.linkId,
  );
  if (link.revision !== body.revision) throw linkChanged();
  const changes = Object.fromEntries(
    Object.entries(body.changes).filter(
      ([key, value]) => link[key as "role" | "status"] !== value,
    ),
  ) as { role?: string | null; status?: "CURRENT" | "FORMER" };
  const leavesPrimary = link.isPrimary && changes.status === "FORMER";
  if (leavesPrimary)
    checkPrimaryClear(
      body.clearPrimary,
      body.primaryRevision,
      profile.primaryRevision,
    );
  let { revision } = link;
  let { primaryRevision } = profile;
  if (Object.keys(changes).length) {
    const updated = await tx.contactCompany.update({
      where: { id: link.id },
      data: {
        ...changes,
        ...(leavesPrimary ? { isPrimary: false } : {}),
        revision: { increment: 1 },
        updatedById: viewer.id,
      },
    });
    revision = updated.revision;
    if (leavesPrimary)
      primaryRevision = (
        await tx.contactProfile.update({
          where: { recordId: link.contactId },
          data: { primaryRevision: { increment: 1 } },
        })
      ).primaryRevision;
    await logLink(tx, viewer.id, contact.task, company, "Changed link", {
      before: { role: link.role, status: link.status },
      role: updated.role,
      status: updated.status,
    });
  }
  return remember(
    tx,
    viewer.id,
    body.requestKey,
    requestDigest,
    resultOf("UPDATED", {
      linkId: link.id,
      contactId: link.contactId,
      companyId: link.companyId,
      contactBoardId: contact.task.boardId,
      companyBoardId: company.boardId,
      primaryRevision,
      revision,
    }),
  );
}

export async function removeLink(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return serial((tx) => removeLinkInTransaction(tx, input, user));
}
export async function removeLinkInTransaction(
  tx: DatabaseTransaction,
  input: unknown,
  viewer: Viewer,
): Promise<LinkResult> {
  const body = linkRemoveSchema.parse(input);
  const requestDigest = digest(stableJson({ action: "remove", ...body }));
  const prior = await replayed(tx, viewer.id, body.requestKey, requestDigest);
  if (prior) return prior;
  const { link, contact, company, profile } = await editableLink(
    tx,
    viewer,
    body.linkId,
  );
  if (link.revision !== body.revision) throw linkChanged();
  if (link.isPrimary)
    checkPrimaryClear(
      body.clearPrimary,
      body.primaryRevision,
      profile.primaryRevision,
    );
  // Deleting a primary link moves the primary revision on (database trigger).
  await tx.contactCompany.delete({ where: { id: link.id } });
  await logLink(tx, viewer.id, contact.task, company, "Unlinked", {
    role: link.role,
    status: link.status,
  });
  const after = await tx.contactProfile.findUniqueOrThrow({
    where: { recordId: link.contactId },
  });
  return remember(
    tx,
    viewer.id,
    body.requestKey,
    requestDigest,
    resultOf("REMOVED", {
      linkId: link.id,
      contactId: link.contactId,
      companyId: link.companyId,
      contactBoardId: contact.task.boardId,
      companyBoardId: company.boardId,
      primaryRevision: after.primaryRevision,
      revision: null,
    }),
  );
}

export async function setPrimary(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return serial((tx) => setPrimaryInTransaction(tx, input, user));
}
/** Chooses (or clears) the contact's one primary company. Never automatic. */
export async function setPrimaryInTransaction(
  tx: DatabaseTransaction,
  input: unknown,
  viewer: Viewer,
): Promise<LinkResult> {
  const body = linkPrimarySchema.parse(input);
  const requestDigest = digest(stableJson({ action: "primary", ...body }));
  const prior = await replayed(tx, viewer.id, body.requestKey, requestDigest);
  if (prior) return prior;
  const contact = await contactFor(tx, viewer.id, body.contactId, true);
  await authorize(tx, contact);
  await lockContact(tx, body.contactId);
  const profile = await tx.contactProfile.findUniqueOrThrow({
    where: { recordId: body.contactId },
  });
  if (profile.primaryRevision !== body.primaryRevision) throw primaryChanged();
  const workspaceId = contact.context.board.workspaceId;
  const current = await tx.contactCompany.findFirst({
    where: { contactId: body.contactId, isPrimary: true },
  });
  // A primary the viewer can't see is never cleared as a side effect.
  if (
    current &&
    !(await visibleRecord(
      tx,
      viewer,
      current.companyId,
      "COMPANY",
      workspaceId,
    ))
  )
    throw restricted();
  if (current?.id === body.linkId) throw primaryChanged();
  let target = null;
  if (body.linkId) {
    target = await tx.contactCompany.findFirst({
      where: { id: body.linkId, contactId: body.contactId },
    });
    if (!target) throw unavailable();
    if (
      body.linkRevision !== undefined &&
      target.revision !== body.linkRevision
    )
      throw linkChanged();
    if (target.status !== "CURRENT")
      throw new SetupError(
        422,
        "FORMER_LINK",
        "Only a current company can be the primary one. Mark it Current first.",
      );
    liveCompany(
      await visibleRecord(tx, viewer, target.companyId, "COMPANY", workspaceId),
    );
  }
  if (current)
    await tx.contactCompany.update({
      where: { id: current.id },
      data: {
        isPrimary: false,
        revision: { increment: 1 },
        updatedById: viewer.id,
      },
    });
  const updated = target
    ? await tx.contactCompany.update({
        where: { id: target.id },
        data: {
          isPrimary: true,
          revision: { increment: 1 },
          updatedById: viewer.id,
        },
      })
    : null;
  const { primaryRevision } = await tx.contactProfile.update({
    where: { recordId: body.contactId },
    data: { primaryRevision: { increment: 1 } },
  });
  const companyId = updated?.companyId ?? current?.companyId ?? null;
  const company = companyId
    ? await tx.task.findUniqueOrThrow({
        where: { id: companyId },
        select: { id: true, boardId: true },
      })
    : null;
  if (company)
    await logLink(tx, viewer.id, contact.task, company, "Primary company", {
      cleared: !updated,
      before: current?.companyId ?? null,
    });
  // The company that stopped being primary sees that on its own record.
  if (current && updated) {
    const previous = await tx.task.findUniqueOrThrow({
      where: { id: current.companyId },
      select: { id: true, boardId: true },
    });
    await tx.boardEvent.create({
      data: {
        boardId: previous.boardId,
        actorId: viewer.id,
        action: "Primary company",
        subjectId: previous.id,
        after: {
          contactId: body.contactId,
          companyId: previous.id,
          cleared: true,
        },
      },
    });
  }
  // With nothing set or cleared there is no company board to refresh.
  const companyBoardId =
    company?.boardId ??
    (
      await tx.board.findFirstOrThrow({
        where: { workspaceId, recordType: "COMPANY" },
        select: { id: true },
      })
    ).id;
  return remember(
    tx,
    viewer.id,
    body.requestKey,
    requestDigest,
    resultOf("PRIMARY_SET", {
      linkId: updated?.id ?? null,
      contactId: body.contactId,
      companyId: updated?.companyId ?? null,
      contactBoardId: contact.task.boardId,
      companyBoardId,
      primaryRevision,
      revision: updated?.revision ?? null,
    }),
  );
}

// ---------- Reads ----------

const detailOf = (task: {
  companyProfile?: { domain: string | null; email: string | null } | null;
  contactProfile?: { email: string | null } | null;
}) =>
  task.companyProfile?.domain ??
  task.companyProfile?.email ??
  task.contactProfile?.email ??
  null;

/** A record's links: a contact's companies (primary, then current, then
 *  former) or a company's people. Links to records the viewer can't see
 *  show as private placeholders on contacts and are left out on companies. */
export async function crmLinks(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  return crmLinksFor(user, input);
}
export async function crmLinksFor(
  viewer: Viewer,
  input: unknown,
): Promise<CrmLinks> {
  const query = crmLinksQuerySchema.parse(input);
  return getDatabase().$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: query.recordId, parentId: null, deletedAt: null },
      select: { boardId: true },
    });
    if (!task) throw unavailable();
    const context = await access(tx, viewer.id, task.boardId);
    const side = context.board.recordType;
    if (side !== "CONTACT" && side !== "COMPANY") throw unavailable();
    const workspaceId = context.board.workspaceId;
    const visibleEnd = {
      deletedAt: null,
      board: { workspaceId, ...boardScope(viewer) },
    };
    const order: Prisma.ContactCompanyOrderByWithRelationInput[] = [
      { isPrimary: "desc" },
      { status: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ];
    const skip = (query.page - 1) * LINK_PAGE_SIZE;
    if (side === "CONTACT") {
      const contact = await contactFor(tx, viewer.id, query.recordId, false);
      const where = { contactId: query.recordId };
      const [total, rows, profile] = await Promise.all([
        tx.contactCompany.count({ where }),
        tx.contactCompany.findMany({
          where,
          orderBy: order,
          skip,
          take: LINK_PAGE_SIZE,
        }),
        tx.contactProfile.findUniqueOrThrow({
          where: { recordId: query.recordId },
        }),
      ]);
      const companies = await tx.task.findMany({
        where: { id: { in: rows.map((row) => row.companyId) }, ...visibleEnd },
        select: {
          id: true,
          name: true,
          archivedAt: true,
          companyProfile: { select: { domain: true, email: true } },
        },
      });
      const policy = await readApprovalPolicy(tx, context.board);
      const editable =
        canEdit(contact.task, context) &&
        !contact.task.archivedAt &&
        !policy.enabled;
      return {
        side,
        page: query.page,
        pageCount: Math.ceil(total / LINK_PAGE_SIZE),
        total,
        primaryRevision: profile.primaryRevision,
        canLink: editable && total < MAX_COMPANY_LINKS,
        blocked: policy.enabled ? approvalBlocked : null,
        links: rows.map((row, index): CrmLink => {
          const company = companies.find((item) => item.id === row.companyId);
          if (!company)
            return {
              visible: false,
              key: `private-${skip + index}`,
              status: row.status as "CURRENT" | "FORMER",
            };
          return {
            visible: true,
            id: row.id,
            revision: row.revision,
            role: row.role,
            status: row.status as "CURRENT" | "FORMER",
            isPrimary: row.isPrimary,
            canEdit: editable && !company.archivedAt,
            record: {
              id: company.id,
              name: company.name,
              detail: detailOf(company),
              archived: Boolean(company.archivedAt),
            },
          };
        }),
      };
    }
    // A company's people: only contacts the viewer may see, counted whole.
    const where: Prisma.ContactCompanyWhereInput = {
      companyId: query.recordId,
      contact: { record: visibleEnd },
    };
    const [total, rows] = await Promise.all([
      tx.contactCompany.count({ where }),
      tx.contactCompany.findMany({
        where,
        orderBy: [
          { status: "asc" },
          { isPrimary: "desc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        skip,
        take: LINK_PAGE_SIZE,
        include: { contact: { include: { record: { include: taskInclude } } } },
      }),
    ]);
    const contactBoard = rows[0]?.contact.record.boardId;
    const contactContext = contactBoard
      ? await access(tx, viewer.id, contactBoard)
      : null;
    const policy = contactContext
      ? await readApprovalPolicy(tx, contactContext.board)
      : { enabled: false };
    const companyTask = await tx.task.findUniqueOrThrow({
      where: { id: query.recordId },
      select: { archivedAt: true },
    });
    return {
      side,
      page: query.page,
      pageCount: Math.ceil(total / LINK_PAGE_SIZE),
      total,
      primaryRevision: null,
      // People are linked from their contact; the picker checks each one.
      canLink: !context.readOnly && !companyTask.archivedAt,
      blocked: policy.enabled ? approvalBlocked : null,
      links: rows.map((row): CrmLink => {
        const person = row.contact.record;
        return {
          visible: true,
          id: row.id,
          revision: row.revision,
          role: row.role,
          status: row.status as "CURRENT" | "FORMER",
          isPrimary: row.isPrimary,
          canEdit: Boolean(
            contactContext &&
            canEdit(person, contactContext) &&
            !person.archivedAt &&
            !companyTask.archivedAt &&
            !policy.enabled,
          ),
          record: {
            id: person.id,
            name: person.name,
            detail: person.contactProfile?.email ?? null,
            archived: Boolean(person.archivedAt),
          },
        };
      }),
    };
  });
}

/** Directory summaries: each contact's visible primary company, and each
 *  company's count of current people the viewer can see. */
export async function linkSummaries(
  tx: DatabaseTransaction,
  viewer: Viewer,
  type: "COMPANY" | "CONTACT",
  workspaceId: string,
  ids: string[],
) {
  const visibleEnd = {
    deletedAt: null,
    board: { workspaceId, ...boardScope(viewer) },
  };
  if (type === "CONTACT") {
    const primaries = await tx.contactCompany.findMany({
      where: {
        contactId: { in: ids },
        isPrimary: true,
        company: { record: visibleEnd },
      },
      select: {
        contactId: true,
        company: { select: { record: { select: { id: true, name: true } } } },
      },
    });
    return new Map(
      primaries.map((row) => [
        row.contactId,
        { primaryCompany: row.company.record },
      ]),
    );
  }
  const counts = await tx.contactCompany.groupBy({
    by: ["companyId"],
    where: {
      companyId: { in: ids },
      status: "CURRENT",
      contact: { record: visibleEnd },
    },
    _count: { _all: true },
  });
  return new Map(
    counts.map((row) => [row.companyId, { currentPeople: row._count._all }]),
  );
}
