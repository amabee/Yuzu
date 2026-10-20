import { verifyPassword } from "better-auth/crypto";
import { getDatabase, type DatabaseTransaction } from "@yuzu/database";
import {
  auditKinds,
  auditQuerySchema,
  personActionSchema,
  roleChangeSchema,
  transferSchema,
  workspaceActionSchema,
  workspaceRenameSchema,
} from "@/lib/admin-contract";
import { SetupError } from "./setup/security";
import { requireAdministrator, requireIdentity } from "./team-access";
import { allowSignIn } from "./auth-rate-limit";
import { audit } from "./audit";
import {
  disconnectPeople,
  notifyNavigationChange,
  refreshNavigationFor,
} from "./realtime";

const db = () => getDatabase();
const PAGE = 50;

async function serial<T>(
  operation: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db().$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2034" &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
}
const forbidden = (message: string) =>
  new SetupError(403, "FORBIDDEN", message);
const missing = () =>
  new SetupError(404, "NOT_FOUND", "That person isn't in this installation.");

/** Re-reads the acting admin inside the transaction: roles can change. */
async function actingAdmin(tx: DatabaseTransaction, userId: string) {
  const me = await tx.user.findUnique({ where: { id: userId } });
  if (!me || me.deactivatedAt || !["OWNER", "ADMIN"].includes(me.role))
    throw forbidden("Administrator access is required.");
  return me;
}

/** Owners manage everyone but themselves; admins manage members only. */
async function manageable(
  tx: DatabaseTransaction,
  me: { id: string; role: string },
  userId: string,
) {
  const target = await tx.user.findUnique({ where: { id: userId } });
  if (!target) throw missing();
  if (target.id === me.id)
    throw forbidden("You can't change your own access here.");
  if (target.role === "OWNER")
    throw forbidden("The owner's access can't be changed.");
  if (target.role === "ADMIN" && me.role !== "OWNER")
    throw forbidden("Only the owner can change an admin's access.");
  return target;
}

export async function peopleState(headers: Headers) {
  const { user } = await requireAdministrator(headers);
  const now = new Date();
  const [people, invitationsWaiting] = await Promise.all([
    db().user.findMany({
      orderBy: [{ name: "asc" }],
      take: 500,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        deactivatedAt: true,
        deactivatedBy: { select: { name: true } },
        memberships: {
          where: { workspace: { archivedAt: null } },
          select: { workspace: { select: { name: true } } },
        },
        sessions: {
          select: { updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        _count: { select: { automationRules: { where: { enabled: true } } } },
      },
    }),
    db().invitation.count({
      where: {
        sentAt: { not: null },
        revokedAt: null,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
    }),
  ]);
  return {
    currentUserId: user.id,
    isOwner: user.role === "OWNER",
    invitationsWaiting,
    people: people.map((person) => ({
      id: person.id,
      name: person.name,
      email: person.email,
      image: person.image,
      role: person.role,
      workspaces: person.memberships.map((item) => item.workspace.name),
      lastActiveAt: person.sessions[0]?.updatedAt.toISOString() ?? null,
      deactivatedAt: person.deactivatedAt?.toISOString() ?? null,
      deactivatedBy: person.deactivatedBy?.name ?? null,
      rules: person._count.automationRules,
    })),
  };
}

export async function changeRole(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = roleChangeSchema.parse(input);
  const changed = await serial(async (tx) => {
    const me = await actingAdmin(tx, user.id);
    if (me.role !== "OWNER")
      throw forbidden("Only the owner can make or remove admins.");
    const target = await manageable(tx, me, body.userId);
    if (target.deactivatedAt)
      throw new SetupError(
        409,
        "DEACTIVATED",
        "Reactivate this person before changing their role.",
      );
    if (target.role === body.role) return false;
    await tx.user.update({
      where: { id: target.id },
      data: { role: body.role },
    });
    await audit(tx, {
      actorId: me.id,
      action: "ROLE_CHANGED",
      subject: target.name,
      subjectId: target.id,
      details: body.role === "ADMIN" ? "an admin" : "a member",
    });
    return true;
  });
  if (changed) await refreshNavigationFor([body.userId]);
  return { saved: true };
}

export async function deactivatePerson(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = personActionSchema.parse(input);
  const result = await serial(async (tx) => {
    const me = await actingAdmin(tx, user.id);
    const target = await manageable(tx, me, body.userId);
    if (target.deactivatedAt) return null;
    await tx.user.update({
      where: { id: target.id },
      data: { deactivatedAt: new Date(), deactivatedById: me.id },
    });
    // Signed out everywhere; sign-in is refused from now on.
    await tx.session.deleteMany({ where: { userId: target.id } });
    // Rules run as their creator, so theirs stop until someone takes over.
    const rules = await tx.automationRule.updateMany({
      where: { createdById: target.id, enabled: true },
      data: {
        enabled: false,
        pausedReason: `Paused: ${target.name} was deactivated. A manager can take it over by saving it.`,
      },
    });
    await tx.apiToken.updateMany({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: me.id },
    });
    const emails = await tx.emailMessage.updateMany({
      where: { userId: target.id, status: "QUEUED" },
      data: { status: "SKIPPED", error: "The account was deactivated." },
    });
    const details = [
      rules.count &&
        `Paused ${rules.count} ${rules.count === 1 ? "rule" : "rules"}`,
      emails.count &&
        `cancelled ${emails.count} ${emails.count === 1 ? "email" : "emails"}`,
    ]
      .filter(Boolean)
      .join(" · ");
    await audit(tx, {
      actorId: me.id,
      action: "USER_DEACTIVATED",
      subject: target.name,
      subjectId: target.id,
      details: details ? details[0]!.toUpperCase() + details.slice(1) : null,
    });
    return { rules: rules.count, emails: emails.count };
  });
  if (result) await disconnectPeople([body.userId]);
  return { deactivated: true, rulesPaused: result?.rules ?? 0 };
}

export async function reactivatePerson(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = personActionSchema.parse(input);
  await serial(async (tx) => {
    const me = await actingAdmin(tx, user.id);
    const target = await manageable(tx, me, body.userId);
    if (!target.deactivatedAt) return;
    await tx.user.update({
      where: { id: target.id },
      data: { deactivatedAt: null, deactivatedById: null },
    });
    await audit(tx, {
      actorId: me.id,
      action: "USER_REACTIVATED",
      subject: target.name,
      subjectId: target.id,
    });
  });
  return { reactivated: true };
}

export async function transferOwnership(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = transferSchema.parse(input);
  if (user.role !== "OWNER")
    throw forbidden("Only the owner can transfer ownership.");
  // Password guesses here count toward the same limit as sign-in.
  if (!(await allowSignIn(user.email)))
    throw new SetupError(
      429,
      "TOO_MANY_ATTEMPTS",
      "Too many attempts. Try again later.",
    );
  const account = await db().account.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (
    !account?.password ||
    !(await verifyPassword({ hash: account.password, password: body.password }))
  )
    throw new SetupError(
      422,
      "WRONG_PASSWORD",
      "That password isn't right. Try again.",
    );
  await serial(async (tx) => {
    const me = await tx.user.findUnique({ where: { id: user.id } });
    if (me?.role !== "OWNER")
      throw forbidden("Only the owner can transfer ownership.");
    const target = await tx.user.findUnique({ where: { id: body.userId } });
    if (!target || target.id === me.id) throw missing();
    if (target.role !== "ADMIN" || target.deactivatedAt)
      throw new SetupError(
        409,
        "NOT_AN_ADMIN",
        "Make this person an admin first, then transfer ownership.",
      );
    await tx.user.update({ where: { id: me.id }, data: { role: "ADMIN" } });
    await tx.user.update({ where: { id: target.id }, data: { role: "OWNER" } });
    await tx.installationSettings.update({
      where: { id: "installation" },
      data: { ownerId: target.id },
    });
    await audit(tx, {
      actorId: me.id,
      action: "OWNERSHIP_TRANSFERRED",
      subject: target.name,
      subjectId: target.id,
    });
  });
  await refreshNavigationFor([user.id, body.userId]);
  return { transferred: true };
}

export async function workspacesState(headers: Headers) {
  await requireAdministrator(headers);
  const workspaces = await db().workspace.findMany({
    orderBy: [
      { archivedAt: { sort: "desc", nulls: "first" } },
      { createdAt: "asc" },
    ],
    take: 200,
    select: {
      id: true,
      name: true,
      archivedAt: true,
      _count: {
        select: { boards: { where: { deletedAt: null } }, members: true },
      },
    },
  });
  return {
    workspaces: workspaces.map((item) => ({
      id: item.id,
      name: item.name,
      archivedAt: item.archivedAt?.toISOString() ?? null,
      boards: item._count.boards,
      members: item._count.members,
    })),
  };
}

export async function renameWorkspace(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = workspaceRenameSchema.parse(input);
  const renamed = await serial(async (tx) => {
    const me = await actingAdmin(tx, user.id);
    const workspace = await tx.workspace.findUnique({
      where: { id: body.workspaceId },
    });
    if (!workspace)
      throw new SetupError(404, "NOT_FOUND", "Workspace not found.");
    if (workspace.name === body.name) return false;
    await tx.workspace.update({
      where: { id: workspace.id },
      data: { name: body.name },
    });
    await audit(tx, {
      actorId: me.id,
      action: "WORKSPACE_RENAMED",
      subject: body.name,
      subjectId: workspace.id,
      workspaceId: workspace.id,
      details: workspace.name,
    });
    return true;
  });
  if (renamed) await notifyNavigationChange({ workspaceId: body.workspaceId });
  return { saved: true };
}

export async function archiveWorkspace(
  input: unknown,
  headers: Headers,
  archive: boolean,
) {
  const { user } = await requireIdentity(headers);
  const body = workspaceActionSchema.parse(input);
  const changed = await serial(async (tx) => {
    const me = await actingAdmin(tx, user.id);
    const workspace = await tx.workspace.findUnique({
      where: { id: body.workspaceId },
    });
    if (!workspace)
      throw new SetupError(404, "NOT_FOUND", "Workspace not found.");
    if (Boolean(workspace.archivedAt) === archive) return false;
    if (
      archive &&
      (await tx.workspace.count({ where: { archivedAt: null } })) <= 1
    )
      throw new SetupError(
        409,
        "LAST_WORKSPACE",
        "Keep at least one workspace open. Create another before archiving this one.",
      );
    await tx.workspace.update({
      where: { id: workspace.id },
      data: { archivedAt: archive ? new Date() : null },
    });
    await audit(tx, {
      actorId: me.id,
      action: archive ? "WORKSPACE_ARCHIVED" : "WORKSPACE_RESTORED",
      subject: workspace.name,
      subjectId: workspace.id,
      workspaceId: workspace.id,
    });
    return true;
  });
  if (changed) await notifyNavigationChange({ workspaceId: body.workspaceId });
  return { saved: true };
}

export async function auditLog(input: unknown, headers: Headers) {
  await requireAdministrator(headers);
  const query = auditQuerySchema.parse(input);
  const since =
    query.range === "all"
      ? undefined
      : new Date(Date.now() - Number(query.range) * 86_400_000);
  const [rows, people] = await Promise.all([
    db().auditEvent.findMany({
      where: {
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.kind
          ? { action: { in: [...auditKinds[query.kind].actions] } }
          : {}),
        ...(since ? { createdAt: { gte: since } } : {}),
        ...(query.before ? { id: { lt: query.before } } : {}),
      },
      // UUIDv7 ids sort by creation time.
      orderBy: { id: "desc" },
      take: PAGE + 1,
      include: {
        actor: { select: { name: true } },
        workspace: { select: { name: true } },
      },
    }),
    db().user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);
  const page = rows.slice(0, PAGE);
  return {
    events: page.map((row) => ({
      id: row.id,
      action: row.action,
      actor: row.actor?.name ?? null,
      subject: row.subject,
      workspace: row.workspace?.name ?? null,
      details: row.details,
      createdAt: row.createdAt.toISOString(),
    })),
    next: rows.length > PAGE ? page.at(-1)!.id : null,
    people,
  };
}
