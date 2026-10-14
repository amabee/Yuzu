import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDatabase } from "@yuzu/database";
import { getAuth } from "./auth";
import { workspaceScope } from "./team-access";

// React cache is request-scoped; never share a session through a module singleton.
export const workspaceContext = cache(async () => {
  const settings = await getDatabase().installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (settings?.setupState !== "READY")
    redirect(settings?.ownerId ? "/setup" : "/welcome");
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const user = await getDatabase().user.findUnique({
    where: { id: session.user.id },
  });
  if (!user) redirect("/sign-in");
  const workspaces = await getDatabase().workspace.findMany({
    where: workspaceScope(user),
    orderBy: { createdAt: "asc" },
  });
  const workspace =
    workspaces.find((item) => item.id === settings.initialWorkspaceId) ??
    workspaces[0] ??
    null;
  return { settings, session, user, workspace, workspaces };
});
