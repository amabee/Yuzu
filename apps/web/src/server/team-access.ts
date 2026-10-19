import { getDatabase } from "@yuzu/database";
import { getAuth } from "./auth";
import { SetupError } from "./setup/security";

export const isAdministrator = (role: string) =>
  role === "OWNER" || role === "ADMIN";

export async function requireIdentity(
  headers: Headers,
  { allowMaintenance = false }: { allowMaintenance?: boolean } = {},
) {
  const db = getDatabase();
  const settings = await db.installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (settings?.setupState !== "READY")
    throw new SetupError(403, "SETUP_REQUIRED", "Complete installation first.");
  const session = await getAuth().api.getSession({ headers });
  if (!session)
    throw new SetupError(401, "SIGN_IN_REQUIRED", "Sign in to continue.");
  // Read current permissions from the database, never trust a cached session role.
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user)
    throw new SetupError(401, "SIGN_IN_REQUIRED", "Sign in to continue.");
  if (user.deactivatedAt)
    throw new SetupError(
      403,
      "DEACTIVATED",
      "This account is deactivated. Ask an administrator to reactivate it.",
    );
  if (
    settings.maintenanceMode &&
    !allowMaintenance &&
    !isAdministrator(user.role)
  )
    throw new SetupError(
      503,
      "MAINTENANCE",
      "Yuzu is undergoing maintenance. Try again shortly.",
    );
  return { settings, session, user };
}

export async function requireAdministrator(headers: Headers) {
  const identity = await requireIdentity(headers);
  if (!isAdministrator(identity.user.role))
    throw new SetupError(
      403,
      "FORBIDDEN",
      "Only owners and administrators can manage team access.",
    );
  return identity;
}

type Principal = { id: string; role: string };

/** Workspaces the user is a full member of (admins: all). Archived
 *  workspaces are hidden from everyone until restored. */
export function workspaceScope(user: Principal) {
  return isAdministrator(user.role)
    ? { archivedAt: null }
    : { archivedAt: null, members: { some: { userId: user.id } } };
}

/** Workspaces to show the user: full memberships, plus any where they belong
 *  to a project (project-only invitees see just that project). */
export function visibleWorkspaceScope(user: Principal) {
  if (isAdministrator(user.role)) return { archivedAt: null };
  return {
    archivedAt: null,
    OR: [
      { members: { some: { userId: user.id } } },
      { projects: { some: { members: { some: { userId: user.id } } } } },
    ],
  };
}

/** Projects the user may see. Private projects are visible only to their
 *  members, not even to admins (they can only recover access, audited). */
export function projectScope(user: Principal) {
  return {
    OR: [
      { visibility: "PUBLIC", workspace: workspaceScope(user) },
      {
        members: { some: { userId: user.id } },
        workspace: { archivedAt: null },
      },
    ],
  };
}

/** Boards the user may see. Every read of boards, or anything inside a board
 *  (tasks, comments, files, notifications, approvals, search, dashboards,
 *  realtime), must filter through this. */
export function boardScope(user: Principal) {
  return {
    OR: [
      { projectId: null, workspace: workspaceScope(user) },
      { project: projectScope(user) },
    ],
  };
}
