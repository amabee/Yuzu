import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import {
  createRecordId,
  getDatabase,
  type DatabaseTransaction,
} from "@yuzu/database";
import {
  acceptInvitationSchema,
  inviteSchema,
  invitationTokenSchema,
  removeMemberSchema,
  revokeSchema,
} from "@/lib/team-contract";
import { configuredOrigin, digest, SetupError } from "./setup/security";
import { recordAccess } from "./audit";
import { requireAdministrator } from "./team-access";
import { getAuth } from "./auth";
import { allowInvitationAttempt } from "./auth-rate-limit";
import { sendVerifiedEmail } from "./email";
import {
  acceptProjectInvitation,
  previewProjectInvitation,
} from "./project-service";

const db = () => getDatabase();
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
        ["P2034", "P2002"].includes(String(error.code)) &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
}
const unavailable = () =>
  new SetupError(
    410,
    "INVITATION_UNAVAILABLE",
    "This invitation has expired, was revoked, or has already been accepted. Ask your administrator for a new invitation.",
  );
async function checkAdministrator(tx: DatabaseTransaction, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || !["OWNER", "ADMIN"].includes(user.role))
    throw new SetupError(403, "FORBIDDEN", "Administrator access is required.");
}
function active(
  invite: {
    sentAt: Date | null;
    revokedAt: Date | null;
    acceptedAt: Date | null;
    expiresAt: Date;
  } | null,
) {
  return (
    invite &&
    invite.sentAt &&
    !invite.revokedAt &&
    !invite.acceptedAt &&
    invite.expiresAt > new Date()
  );
}

export async function teamState(headers: Headers) {
  await requireAdministrator(headers);
  const [workspaces, members, invitations] = await Promise.all([
    db().workspace.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    db().workspaceMember.findMany({ include: { user: true } }),
    db().invitation.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  return {
    workspaces,
    members: members.map((member) => ({
      workspaceId: member.workspaceId,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      role: member.user.role,
    })),
    invitations: invitations.map((invite) => ({
      id: invite.id,
      workspaceId: invite.workspaceId,
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
      status: invite.acceptedAt
        ? "accepted"
        : invite.revokedAt
          ? "revoked"
          : invite.expiresAt <= new Date()
            ? "expired"
            : invite.sentAt
              ? "pending"
              : "sending",
    })),
  };
}

export async function sendInvitation(input: unknown, headers: Headers) {
  const { user, settings } = await requireAdministrator(headers);
  const { workspaceId, email } = inviteSchema.parse(input);
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
    const currentUser = await tx.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    if (!["OWNER", "ADMIN"].includes(currentUser.role))
      throw new SetupError(
        403,
        "FORBIDDEN",
        "Administrator access is required.",
      );
    const workspace = await tx.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace)
      throw new SetupError(404, "NOT_FOUND", "Workspace not found.");
    const recipient = await tx.user.findUnique({ where: { email } });
    if (
      recipient &&
      (recipient.role === "OWNER" ||
        recipient.role === "ADMIN" ||
        (await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: recipient.id } },
        })))
    )
      throw new SetupError(
        409,
        "ALREADY_MEMBER",
        "This person already has workspace access.",
      );
    const previous = await tx.invitation.findUnique({
      where: { workspaceId_email: { workspaceId, email } },
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
      invitedById: user.id,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      sentAt: null,
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    const invite = await tx.invitation.upsert({
      where: { workspaceId_email: { workspaceId, email } },
      create: { ...data, workspaceId, email },
      update: data,
    });
    return { ...invite, workspaceName: workspace.name };
  });
  try {
    await sendVerifiedEmail(
      settings,
      email,
      `Join ${settings.name}`,
      `${user.name} invited you to join ${invitation.workspaceName} in ${settings.name}.\n\n${configuredOrigin()}/invite#${token}\n\nThis link expires in seven days and grants workspace membership only. If you were not expecting this invitation, you can ignore it.`,
    );
    const marked = await db().invitation.updateMany({
      where: { id: invitation.id, tokenDigest, revokedAt: null },
      data: { sentAt: new Date() },
    });
    if (!marked.count) throw unavailable();
    await recordAccess(db(), {
      workspaceId,
      actorId: user.id,
      action: "INVITATION_SENT",
      subjectEmail: email,
    });
    return { sent: true };
  } catch (error) {
    await db().invitation.updateMany({
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

export async function revokeInvitation(input: unknown, headers: Headers) {
  const { user } = await requireAdministrator(headers);
  const { id } = revokeSchema.parse(input);
  await serial(async (tx) => {
    await checkAdministrator(tx, user.id);
    const invite = await tx.invitation.findUnique({ where: { id } });
    if (!invite)
      throw new SetupError(404, "NOT_FOUND", "Invitation not found.");
    if (invite.acceptedAt)
      throw new SetupError(
        409,
        "ALREADY_ACCEPTED",
        "Remove the member instead; this invitation was already accepted.",
      );
    await tx.invitation.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await recordAccess(tx, {
      workspaceId: invite.workspaceId,
      actorId: user.id,
      action: "INVITATION_REVOKED",
      subjectEmail: invite.email,
    });
  });
  return { revoked: true };
}

export async function removeMember(input: unknown, headers: Headers) {
  const { user } = await requireAdministrator(headers);
  const { workspaceId, userId } = removeMemberSchema.parse(input);
  await serial(async (tx) => {
    await checkAdministrator(tx, user.id);
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (
      !target ||
      !(await tx.workspace.findUnique({ where: { id: workspaceId } }))
    )
      throw new SetupError(404, "NOT_FOUND", "Member or workspace not found.");
    if (["OWNER", "ADMIN"].includes(target.role))
      throw new SetupError(
        409,
        "ADMINISTRATOR_ACCESS",
        "Owners and administrators have installation-wide access and cannot be removed through workspace membership.",
      );
    await tx.workspaceMember.deleteMany({ where: { workspaceId, userId } });
    // Leaving the workspace also leaves its projects, except projects they were
    // invited to directly (project-only access stands on its own).
    await tx.projectMember.deleteMany({
      where: { userId, projectOnly: false, project: { workspaceId } },
    });
    // Also revoke outstanding invitations so removal cannot be undone by an old link.
    await tx.invitation.updateMany({
      where: { workspaceId, email: target.email, acceptedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAccess(tx, {
      workspaceId,
      actorId: user.id,
      action: "MEMBER_REMOVED",
      subjectEmail: target.email,
    });
  });
  return { removed: true };
}

export async function previewInvitation(input: unknown, headers: Headers) {
  const { token } = invitationTokenSchema.parse(input);
  // One /invite link for both kinds: project invitations are checked first.
  const project = await previewProjectInvitation(digest(token), headers);
  if (project) return project;
  const invite = await db().invitation.findUnique({
    where: { tokenDigest: digest(token) },
    include: { workspace: true },
  });
  if (!active(invite)) throw unavailable();
  const session = await getAuth().api.getSession({ headers });
  return {
    workspaceName: invite!.workspace.name,
    email: invite!.email,
    existingAccount: Boolean(
      await db().user.findUnique({ where: { email: invite!.email } }),
    ),
    signedInAsRecipient: session?.user.email.toLowerCase() === invite!.email,
    signedInAsOther: Boolean(
      session && session.user.email.toLowerCase() !== invite!.email,
    ),
  };
}

export async function acceptInvitation(input: unknown, headers: Headers) {
  const project = await acceptProjectInvitation(input, headers);
  if (project) return project;
  const { token, name, password } = acceptInvitationSchema.parse(input);
  const tokenDigest = digest(token);
  const invite = await db().invitation.findUnique({ where: { tokenDigest } });
  if (!active(invite)) throw unavailable();
  if (!(await allowInvitationAttempt(token)))
    throw new SetupError(
      429,
      "TOO_MANY_ATTEMPTS",
      "Too many invitation attempts. Try again later.",
    );
  const settings = await db().installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (settings?.setupState !== "READY")
    throw new SetupError(403, "SETUP_REQUIRED", "Complete installation first.");
  const session = await getAuth().api.getSession({ headers });
  if (session && session.user.email.toLowerCase() !== invite!.email)
    throw new SetupError(
      403,
      "WRONG_ACCOUNT",
      "Sign out of the current account before accepting this invitation.",
    );
  const existing = await db().user.findUnique({
    where: { email: invite!.email },
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
    const current = await tx.invitation.findUnique({ where: { tokenDigest } });
    if (!active(current)) throw unavailable();
    const account = await tx.user.findUnique({
      where: { email: current!.email },
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
          email: current!.email,
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
    await tx.user.update({
      where: { id: recipient.id },
      data: { emailVerified: true },
    });
    await tx.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: current!.workspaceId,
          userId: recipient.id,
        },
      },
      create: { workspaceId: current!.workspaceId, userId: recipient.id },
      update: {},
    });
    await tx.invitation.update({
      where: { id: current!.id },
      data: { acceptedAt: new Date() },
    });
    await recordAccess(tx, {
      workspaceId: current!.workspaceId,
      actorId: recipient.id,
      action: "INVITATION_ACCEPTED",
      subjectEmail: recipient.email,
    });
  });
  return { accepted: true, signedIn: Boolean(existing) };
}
