import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import {
  createRecordId,
  getDatabase,
  type DatabaseTransaction,
} from "@yuzu/database";
import {
  moveBoardSchema,
  projectCreateSchema,
  projectIdSchema,
  projectInviteRevokeSchema,
  projectInviteSchema,
  projectListSchema,
  projectMemberSchema,
  projectRecoverSchema,
  projectReorderSchema,
  projectUpdateSchema,
  type ProjectSummary,
} from "@/lib/project-contract";
import { acceptInvitationSchema } from "@/lib/team-contract";
import { access, serial } from "./board-service";
import { projectAccess } from "./project-access";
import {
  isAdministrator,
  projectScope,
  requireAdministrator,
  requireIdentity,
  workspaceScope,
} from "./team-access";
import { configuredOrigin, digest, SetupError } from "./setup/security";
import { getAuth } from "./auth";
import { allowInvitationAttempt } from "./auth-rate-limit";
import { sendVerifiedEmail } from "./email";

const db = getDatabase;
type Principal = { id: string; role: string };

const forbidden = (message: string) =>
  new SetupError(403, "FORBIDDEN", message);
const changed = () =>
  new SetupError(
    409,
    "PROJECT_CHANGED",
    "This project changed since you opened it. Reload and try again.",
  );

async function writer(tx: DatabaseTransaction, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user)
    throw new SetupError(401, "SIGN_IN_REQUIRED", "Sign in to continue.");
  const settings = await tx.installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (settings?.maintenanceMode)
    throw new SetupError(
      503,
      "MAINTENANCE",
      "Changes are paused during maintenance.",
    );
  return user;
}
async function manage(tx: DatabaseTransaction, user: Principal, id: string) {
  const context = await projectAccess(tx, user, id);
  if (!context.canManage)
    throw forbidden("Only this project's managers can change it.");
  return context;
}
function uniqueName(error: unknown): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  )
    throw new SetupError(
      409,
      "PROJECT_NAME_TAKEN",
      "A project with this name already exists in this workspace.",
    );
  throw error;
}

/* ---------- Reading ---------- */

export async function listProjects(
  headers: Headers,
  input: unknown,
): Promise<{ projects: ProjectSummary[] }> {
  const { user } = await requireIdentity(headers);
  const query = projectListSchema.parse(input);
  const projects = await db().project.findMany({
    where: {
      workspaceId: query.workspaceId,
      archivedAt: query.archived === "true" ? { not: null } : null,
      ...projectScope(user),
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    take: 200,
    include: {
      members: { where: { userId: user.id }, select: { role: true } },
      boards: {
        select: { id: true, name: true, position: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        take: 200,
      },
    },
  });
  return {
    projects: projects.map((project) => {
      const role = (project.members[0]?.role ?? null) as ProjectSummary["role"];
      return {
        id: project.id,
        workspaceId: project.workspaceId,
        name: project.name,
        color: project.color as ProjectSummary["color"],
        visibility: project.visibility as ProjectSummary["visibility"],
        position: project.position,
        archived: Boolean(project.archivedAt),
        revision: project.revision,
        role,
        canManage:
          role === "MANAGER" ||
          (isAdministrator(user.role) && project.visibility === "PUBLIC"),
        boards: project.boards,
      };
    }),
  };
}

/** Admin directory for Settings: every project, private ones included, but only
 *  names and managers, never their boards or contents. */
export async function projectDirectory(headers: Headers) {
  await requireAdministrator(headers);
  const projects = await db().project.findMany({
    orderBy: [{ workspaceId: "asc" }, { position: "asc" }],
    take: 500,
    select: {
      id: true,
      workspaceId: true,
      name: true,
      visibility: true,
      archivedAt: true,
      members: {
        where: { role: "MANAGER" },
        select: { user: { select: { id: true, name: true } } },
      },
    },
  });
  return {
    projects: projects.map((project) => ({
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      visibility: project.visibility,
      archived: Boolean(project.archivedAt),
      managers: project.members.map((member) => member.user),
    })),
  };
}

/* ---------- Creating and changing projects ---------- */

export async function createProject(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = projectCreateSchema.parse(input);
  return serial(async (tx) => {
    const current = await writer(tx, user.id);
    // Any full member of the workspace may start a project and manages it.
    const workspace = await tx.workspace.findFirst({
      where: { id: body.workspaceId, ...workspaceScope(current) },
    });
    if (!workspace)
      throw new SetupError(
        404,
        "NOT_FOUND",
        "This workspace is not available.",
      );
    const position = await tx.project.count({
      where: { workspaceId: workspace.id },
    });
    const project = await tx.project
      .create({
        data: {
          workspaceId: workspace.id,
          name: body.name,
          color: body.color,
          visibility: body.visibility,
          position,
          createdById: current.id,
          members: {
            create: {
              userId: current.id,
              role: "MANAGER",
              grantedById: current.id,
            },
          },
        },
        select: { id: true },
      })
      .catch(uniqueName);
    return project;
  });
}

export async function updateProject(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = projectUpdateSchema.parse(input);
  return serial(async (tx) => {
    const current = await writer(tx, user.id);
    const { project } = await manage(tx, current, body.projectId);
    if (project.revision !== body.revision) throw changed();
    const updated = await tx.project
      .update({
        where: { id: project.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.visibility !== undefined
            ? { visibility: body.visibility }
            : {}),
          revision: { increment: 1 },
        },
        select: { id: true, revision: true },
      })
      .catch(uniqueName);
    return updated;
  });
}

export async function reorderProjects(input: unknown, headers: Headers) {
  const { user } = await requireAdministrator(headers);
  const body = projectReorderSchema.parse(input);
  return serial(async (tx) => {
    await writer(tx, user.id);
    const existing = await tx.project.findMany({
      where: { workspaceId: body.workspaceId },
      select: { id: true },
    });
    const ids = new Set(existing.map((project) => project.id));
    if (
      ids.size !== body.projectIds.length ||
      new Set(body.projectIds).size !== body.projectIds.length ||
      body.projectIds.some((id) => !ids.has(id))
    )
      throw new SetupError(
        422,
        "INVALID_ORDER",
        "Include every project in this workspace exactly once.",
      );
    for (const [position, id] of body.projectIds.entries())
      await tx.project.update({ where: { id }, data: { position } });
    return { reordered: true };
  });
}

export async function setProjectArchived(
  input: unknown,
  headers: Headers,
  archived: boolean,
) {
  const { user } = await requireIdentity(headers);
  const { projectId } = projectIdSchema.parse(input);
  return serial(async (tx) => {
    const current = await writer(tx, user.id);
    const { project } = await manage(tx, current, projectId);
    await tx.project.update({
      where: { id: project.id },
      data: {
        archivedAt: archived ? new Date() : null,
        revision: { increment: 1 },
      },
    });
    return { archived };
  });
}

/* ---------- Members ---------- */

export async function changeProjectMember(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = projectMemberSchema.parse(input);
  return serial(async (tx) => {
    const current = await writer(tx, user.id);
    const { project } = await manage(tx, current, body.projectId);
    const key = { projectId: project.id, userId: body.userId };
    const managers = await tx.projectMember.count({
      where: { projectId: project.id, role: "MANAGER" },
    });
    const target = await tx.projectMember.findUnique({
      where: { projectId_userId: key },
    });
    const lastManager =
      target?.role === "MANAGER" &&
      managers <= 1 &&
      (body.action === "remove" ||
        (body.action === "role" && body.role === "MEMBER"));
    if (lastManager)
      throw new SetupError(
        409,
        "LAST_MANAGER",
        "Make someone else a manager before changing the last one.",
      );
    if (body.action === "add") {
      // People already in the workspace join directly; outsiders need an invitation.
      const member = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: project.workspaceId,
            userId: body.userId,
          },
        },
      });
      if (!member)
        throw new SetupError(
          422,
          "INVITE_REQUIRED",
          "This person isn't in the workspace. Invite them by email instead.",
        );
      await tx.projectMember.upsert({
        where: { projectId_userId: key },
        create: { ...key, role: body.role, grantedById: current.id },
        update: { role: body.role },
      });
    } else if (body.action === "role") {
      if (!target)
        throw new SetupError(404, "NOT_FOUND", "This person isn't a member.");
      await tx.projectMember.update({
        where: { projectId_userId: key },
        data: { role: body.role },
      });
    } else {
      await tx.projectMember.deleteMany({ where: key });
      // An old invitation link must not bring them back.
      const removed = await tx.user.findUnique({
        where: { id: body.userId },
        select: { email: true },
      });
      if (removed)
        await tx.projectInvitation.updateMany({
          where: {
            projectId: project.id,
            email: removed.email,
            acceptedAt: null,
          },
          data: { revokedAt: new Date() },
        });
    }
    await tx.project.update({
      where: { id: project.id },
      data: { revision: { increment: 1 } },
    });
    return { changed: true };
  });
}

/* ---------- Invitations (people inside or outside the workspace) ---------- */

export async function inviteToProject(input: unknown, headers: Headers) {
  const { user, settings } = await requireIdentity(headers);
  const body = projectInviteSchema.parse(input);
  if (
    !settings.emailConfig ||
    settings.emailVerifiedRevision !== settings.emailConfigRevision
  )
    throw new SetupError(
      503,
      "EMAIL_REQUIRED",
      "Verified email configuration is required.",
    );
  const token = randomBytes(32).toString("base64url");
  const tokenDigest = digest(token);
  const invitation = await serial(async (tx) => {
    const current = await writer(tx, user.id);
    const { project } = await manage(tx, current, body.projectId);
    const recipient = await tx.user.findUnique({
      where: { email: body.email },
    });
    if (
      recipient &&
      (await tx.projectMember.findUnique({
        where: {
          projectId_userId: { projectId: project.id, userId: recipient.id },
        },
      }))
    )
      throw new SetupError(
        409,
        "ALREADY_MEMBER",
        "This person is already in the project.",
      );
    const previous = await tx.projectInvitation.findUnique({
      where: {
        projectId_email: { projectId: project.id, email: body.email },
      },
    });
    if (
      previous &&
      !previous.revokedAt &&
      !previous.acceptedAt &&
      previous.createdAt.getTime() > Date.now() - 60_000
    )
      throw new SetupError(
        429,
        "WAIT_TO_RESEND",
        "Wait one minute before sending another invitation.",
      );
    const data = {
      tokenDigest,
      role: body.role,
      invitedById: current.id,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      sentAt: null,
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    const invite = await tx.projectInvitation.upsert({
      where: {
        projectId_email: { projectId: project.id, email: body.email },
      },
      create: { ...data, projectId: project.id, email: body.email },
      update: data,
    });
    return { ...invite, project };
  });
  try {
    await sendVerifiedEmail(
      settings,
      body.email,
      `Join ${invitation.project.name} in ${settings.name}`,
      `${user.name} invited you to the project ${invitation.project.name} in ${settings.name}.\n\n${configuredOrigin()}/invite#${token}\n\nThis link expires in seven days and gives access to this project only. If you were not expecting this invitation, you can ignore it.`,
    );
    const marked = await db().projectInvitation.updateMany({
      where: { id: invitation.id, tokenDigest, revokedAt: null },
      data: { sentAt: new Date() },
    });
    if (!marked.count)
      throw new SetupError(
        410,
        "INVITATION_UNAVAILABLE",
        "This invitation was revoked while sending.",
      );
    await db().accessEvent.create({
      data: {
        workspaceId: invitation.project.workspaceId,
        actorId: user.id,
        action: "PROJECT_INVITATION_SENT",
        subjectEmail: body.email,
      },
    });
    return { sent: true };
  } catch (error) {
    await db().projectInvitation.updateMany({
      where: { id: invitation.id, tokenDigest, acceptedAt: null },
      data: { revokedAt: new Date() },
    });
    if (error instanceof SetupError) throw error;
    throw new SetupError(
      502,
      "EMAIL_FAILED",
      "The invitation could not be sent. Check the email server and try again.",
    );
  }
}

export async function revokeProjectInvitation(
  input: unknown,
  headers: Headers,
) {
  const { user } = await requireIdentity(headers);
  const { id } = projectInviteRevokeSchema.parse(input);
  return serial(async (tx) => {
    const current = await writer(tx, user.id);
    const invite = await tx.projectInvitation.findUnique({ where: { id } });
    if (!invite)
      throw new SetupError(404, "NOT_FOUND", "Invitation not found.");
    const { project } = await manage(tx, current, invite.projectId);
    if (invite.acceptedAt)
      throw new SetupError(
        409,
        "ALREADY_ACCEPTED",
        "Remove the member instead; this invitation was already accepted.",
      );
    await tx.projectInvitation.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await tx.accessEvent.create({
      data: {
        workspaceId: project.workspaceId,
        actorId: current.id,
        action: "PROJECT_INVITATION_REVOKED",
        subjectEmail: invite.email,
      },
    });
    return { revoked: true };
  });
}

type InviteState = {
  sentAt: Date | null;
  revokedAt: Date | null;
  acceptedAt: Date | null;
  expiresAt: Date;
} | null;
const usable = (invite: InviteState) =>
  Boolean(
    invite &&
    invite.sentAt &&
    !invite.revokedAt &&
    !invite.acceptedAt &&
    invite.expiresAt > new Date(),
  );
const unavailable = () =>
  new SetupError(
    410,
    "INVITATION_UNAVAILABLE",
    "This invitation has expired, was revoked, or has already been accepted. Ask the project manager for a new invitation.",
  );

/** Called by the shared /invite flow when the token belongs to a project. */
export async function previewProjectInvitation(
  tokenDigest: string,
  headers: Headers,
) {
  const invite = await db().projectInvitation.findUnique({
    where: { tokenDigest },
    include: { project: { select: { name: true } } },
  });
  if (!invite) return null;
  if (!usable(invite)) throw unavailable();
  const session = await getAuth().api.getSession({ headers });
  return {
    workspaceName: invite.project.name,
    email: invite.email,
    existingAccount: Boolean(
      await db().user.findUnique({ where: { email: invite.email } }),
    ),
    signedInAsRecipient: session?.user.email.toLowerCase() === invite.email,
    signedInAsOther: Boolean(
      session && session.user.email.toLowerCase() !== invite.email,
    ),
  };
}

/** Called by the shared /invite flow when the token belongs to a project.
 *  Returns null when it doesn't, so the workspace flow can handle it. */
export async function acceptProjectInvitation(
  input: unknown,
  headers: Headers,
) {
  const { token, name, password } = acceptInvitationSchema.parse(input);
  const tokenDigest = digest(token);
  const invite = await db().projectInvitation.findUnique({
    where: { tokenDigest },
  });
  if (!invite) return null;
  if (!usable(invite)) throw unavailable();
  if (!(await allowInvitationAttempt(token)))
    throw new SetupError(
      429,
      "TOO_MANY_ATTEMPTS",
      "Too many invitation attempts. Try again later.",
    );
  const session = await getAuth().api.getSession({ headers });
  if (session && session.user.email.toLowerCase() !== invite.email)
    throw new SetupError(
      403,
      "WRONG_ACCOUNT",
      "Sign out of the current account before accepting this invitation.",
    );
  const existing = await db().user.findUnique({
    where: { email: invite.email },
  });
  if (existing && session?.user.id !== existing.id)
    throw new SetupError(
      403,
      "RECIPIENT_SIGN_IN_REQUIRED",
      "Sign in with the invited email address before accepting this invitation.",
    );
  if (!existing && (!name || !password))
    throw new SetupError(
      422,
      "ACCOUNT_REQUIRED",
      "Enter your name and a password of at least 12 characters.",
    );
  const passwordHash = !existing ? await hashPassword(password!) : null;
  await serial(async (tx) => {
    const current = await tx.projectInvitation.findUnique({
      where: { tokenDigest },
      include: { project: true },
    });
    if (!current || !usable(current)) throw unavailable();
    const account = await tx.user.findUnique({
      where: { email: current.email },
    });
    if (account && session?.user.id !== account.id)
      throw new SetupError(
        403,
        "RECIPIENT_SIGN_IN_REQUIRED",
        "Sign in with the invited email address first.",
      );
    if (!account && !passwordHash)
      throw new SetupError(
        409,
        "ACCOUNT_CHANGED",
        "Refresh the invitation and try again.",
      );
    const newUserId = createRecordId();
    const recipient =
      account ??
      (await tx.user.create({
        data: {
          id: newUserId,
          name: name!,
          email: current.email,
          emailVerified: true,
          role: "MEMBER",
          accounts: {
            create: {
              id: createRecordId(),
              accountId: newUserId,
              providerId: "credential",
              password: passwordHash!,
            },
          },
        },
      }));
    const inWorkspace = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: current.project.workspaceId,
          userId: recipient.id,
        },
      },
    });
    await tx.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId: current.projectId,
          userId: recipient.id,
        },
      },
      create: {
        projectId: current.projectId,
        userId: recipient.id,
        role: current.role,
        projectOnly: !inWorkspace && !isAdministrator(recipient.role),
        grantedById: current.invitedById,
      },
      update: { role: current.role },
    });
    await tx.projectInvitation.update({
      where: { id: current.id },
      data: { acceptedAt: new Date() },
    });
    await tx.accessEvent.create({
      data: {
        workspaceId: current.project.workspaceId,
        actorId: recipient.id,
        action: "PROJECT_INVITATION_ACCEPTED",
        subjectEmail: recipient.email,
      },
    });
  });
  return { accepted: true, signedIn: Boolean(existing) };
}

/* ---------- Admin recovery of a private project ---------- */

export async function recoverProject(input: unknown, headers: Headers) {
  const { user, settings } = await requireAdministrator(headers);
  const body = projectRecoverSchema.parse(input);
  const result = await serial(async (tx) => {
    await writer(tx, user.id);
    const project = await tx.project.findUnique({
      where: { id: body.projectId },
      include: {
        members: {
          where: { role: "MANAGER" },
          include: { user: { select: { email: true } } },
        },
      },
    });
    if (!project) throw new SetupError(404, "NOT_FOUND", "Project not found.");
    if (body.confirmName !== project.name)
      throw new SetupError(
        422,
        "CONFIRMATION_MISMATCH",
        "Type the project name exactly to confirm.",
      );
    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: user.id } },
      create: {
        projectId: project.id,
        userId: user.id,
        role: "MANAGER",
        grantedById: user.id,
      },
      update: { role: "MANAGER" },
    });
    await tx.accessEvent.create({
      data: {
        workspaceId: project.workspaceId,
        actorId: user.id,
        action: "PROJECT_ACCESS_RECOVERED",
        subjectEmail: user.email,
      },
    });
    return {
      name: project.name,
      managerEmails: project.members
        .map((member) => member.user.email)
        .filter((email) => email !== user.email),
    };
  });
  // Tell the existing managers; recovery must never be silent.
  await Promise.allSettled(
    result.managerEmails.map((email) =>
      sendVerifiedEmail(
        settings,
        email,
        `${user.name} recovered access to ${result.name}`,
        `${user.name}, an administrator of ${settings.name}, used access recovery to join the private project ${result.name} as a manager.\n\nIf this wasn't expected, contact them or another administrator.`,
      ),
    ),
  );
  return { recovered: true };
}

/* ---------- Moving boards ---------- */

export async function moveBoard(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = moveBoardSchema.parse(input);
  return serial(async (tx) => {
    const current = await writer(tx, user.id);
    const { board, canManage: canManageBoard } = await access(
      tx,
      current.id,
      body.boardId,
      true,
    );
    if (board.projectId === body.projectId) return { moved: false };
    // Leaving a project needs its manager; leaving standalone needs the board's manager.
    const source = board.projectId
      ? (await projectAccess(tx, current, board.projectId)).canManage
      : canManageBoard;
    if (!source)
      throw forbidden(
        "You need to manage this board's current project to move it.",
      );
    let position = 0;
    if (body.projectId) {
      const target = await projectAccess(tx, current, body.projectId);
      if (!target.canManage)
        throw forbidden("You need to manage the project you're moving it to.");
      if (target.project.workspaceId !== board.workspaceId)
        throw new SetupError(
          422,
          "OTHER_WORKSPACE",
          "Boards can only move to projects in the same workspace.",
        );
      if (target.project.archivedAt)
        throw new SetupError(
          409,
          "PROJECT_ARCHIVED",
          "Restore the project before moving boards into it.",
        );
      position = await tx.board.count({ where: { projectId: body.projectId } });
    } else if (!canManageBoard)
      throw forbidden("You need to manage this board to make it standalone.");
    await tx.board.update({
      where: { id: board.id },
      data: { projectId: body.projectId, position },
    });
    await tx.boardEvent.create({
      data: {
        boardId: board.id,
        actorId: current.id,
        action: "Moved board",
        before: { projectId: board.projectId },
        after: { projectId: body.projectId },
      },
    });
    return { moved: true };
  });
}
