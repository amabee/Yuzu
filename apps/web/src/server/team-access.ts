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

export function workspaceScope(user: { id: string; role: string }) {
  return isAdministrator(user.role)
    ? {}
    : { members: { some: { userId: user.id } } };
}
