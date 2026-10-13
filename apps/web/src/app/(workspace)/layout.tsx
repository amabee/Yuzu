import { getDatabase } from "@yuzu/database";
import { workspaceContext } from "@/server/workspace-access";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { settings, session } = await workspaceContext();
  const workspace = settings.initialWorkspaceId
    ? await getDatabase().workspace.findUnique({
        where: { id: settings.initialWorkspaceId },
      })
    : null;
  return (
    <AppShell
      installationName={settings.name}
      workspaceName={workspace?.name}
      ownerName={session.user.name}
    >
      {children}
    </AppShell>
  );
}
