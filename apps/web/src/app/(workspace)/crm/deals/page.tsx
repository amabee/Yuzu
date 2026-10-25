import { getDatabase } from "@yuzu/database";
import { DealsIndex } from "@/components/crm/deals-index";
import { workspaceScope } from "@/server/team-access";
import { workspaceContext } from "@/server/workspace-access";

export const metadata = { title: "Deals" };
export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const params = await searchParams;
  const { user, workspace: initial } = await workspaceContext();
  // CRM belongs to full workspace members.
  const workspaces = await getDatabase().workspace.findMany({
    where: workspaceScope(user),
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const workspace =
    workspaces.find((item) => item.id === params.workspace) ??
    workspaces.find((item) => item.id === initial?.id) ??
    workspaces[0];
  if (!workspace)
    return (
      <p className="p-6 text-muted-foreground">
        CRM is shared by workspace members. Ask an administrator to add you to a
        workspace.
      </p>
    );
  return (
    <DealsIndex
      key={workspace.id}
      principalId={user.id}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
    />
  );
}
