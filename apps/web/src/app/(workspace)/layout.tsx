import { CsvTransferRuntime } from "@/components/transfers/csv-transfer-runtime";
import { workspaceContext } from "@/server/workspace-access";
import { boardScope } from "@/server/team-access";
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
    where: {
      workspaceId: { in: workspaces.map((item) => item.id) },
      // Boards of archived projects stay readable by link but leave navigation.
      AND: [
        boardScope(user),
        { OR: [{ projectId: null }, { project: { archivedAt: null } }] },
      ],
    },
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
    <CsvTransferRuntime key={user.id} principalId={user.id}>
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
    </CsvTransferRuntime>
  );
}
