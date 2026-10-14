import { workspaceContext } from "@/server/workspace-access";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { settings, session, workspace } = await workspaceContext();
  return (
    <AppShell
      installationName={settings.name}
      workspaceName={workspace?.name ?? "No workspace access"}
      ownerName={session.user.name}
    >
      {children}
    </AppShell>
  );
}
