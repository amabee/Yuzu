import { workspaceContext } from "@/server/workspace-access";
import { getDatabase } from "@yuzu/database";
import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { settings, user, workspace, workspaces } = await workspaceContext();
  const boards = await getDatabase().board.findMany({
    where: { workspaceId: { in: workspaces.map((item) => item.id) } },
    select: { id: true, name: true, workspaceId: true },
    orderBy: { createdAt: "asc" },
  });
  const navigationWorkspaces = workspaces.map((item) => ({
    id: item.id,
    name: item.name,
    boards: boards
      .filter((board) => board.workspaceId === item.id)
      .map(({ id, name }) => ({ id, name })),
  }));
  const sidebarDefaultOpen =
    (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    <AppShell
      principalId={user.id}
      sidebarDefaultOpen={sidebarDefaultOpen}
      installationName={settings.name}
      workspaceName={workspace?.name ?? "No workspace access"}
      ownerName={user.name}
      role={user.role}
      workspaces={navigationWorkspaces}
    >
      {children}
    </AppShell>
  );
}
