import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDatabase } from "@yuzu/database";
import { getAuth } from "./auth";

// React cache is request-scoped; never share a session through a module singleton.
export const workspaceContext = cache(async () => {
  const settings = await getDatabase().installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (settings?.setupState !== "READY")
    redirect(settings?.ownerId ? "/setup" : "/welcome");
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (
    !session ||
    session.user.id !== settings.ownerId ||
    session.user.role !== "OWNER"
  )
    redirect("/sign-in");
  return { settings, session };
});
