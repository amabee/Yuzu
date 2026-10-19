import Link from "next/link";
import { forbidden } from "next/navigation";
import { workspaceContext } from "@/server/workspace-access";
import { isAdministrator } from "@/server/team-access";
import { WorkspacesManager } from "@/components/team/workspaces-manager";

export const metadata = { title: "Workspaces" };
export default async function WorkspacesPage() {
  const { user } = await workspaceContext();
  if (!isAdministrator(user.role)) forbidden();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/settings" className="text-xs text-muted-foreground">
        ← Settings
      </Link>
      <h1 className="mt-3 text-3xl font-semibold">Workspaces</h1>
      <p className="mt-3 mb-8 text-sm text-muted-foreground">
        Rename workspaces, or archive the ones you no longer use. Archiving
        hides a workspace and its boards from everyone; nothing is deleted.
      </p>
      <WorkspacesManager currentUserId={user.id} />
    </div>
  );
}
