import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect, unauthorized } from "next/navigation";
import { getDatabase } from "@yuzu/database";
import { getAuth } from "./auth";
import { isAdministrator, visibleWorkspaceScope } from "./team-access";

// React cache is request-scoped; never share a session through a module singleton.
export const workspaceContext = cache(async () => {
  const settings = await getDatabase().installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (settings?.setupState !== "READY")
    redirect(settings?.ownerId ? "/setup" : "/welcome");
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const { authCookies } = await auth.$context;
    // A stale/revoked session gets a recovery page; new visitors go to sign-in.
    if ((await cookies()).has(authCookies.sessionToken.name)) unauthorized();
    redirect("/sign-in");
  }
  const user = await getDatabase().user.findUnique({
    where: { id: session.user.id },
  });
  if (!user) unauthorized();
  if (settings.maintenanceMode && !isAdministrator(user.role))
    redirect("/maintenance");
  const workspaces = await getDatabase().workspace.findMany({
    where: visibleWorkspaceScope(user),
    orderBy: { createdAt: "asc" },
  });
  const workspace =
    workspaces.find((item) => item.id === settings.initialWorkspaceId) ??
    workspaces[0] ??
    null;
  return { settings, session, user, workspace, workspaces };
});
