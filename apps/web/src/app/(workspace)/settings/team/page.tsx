import { forbidden } from "next/navigation";
import { workspaceContext } from "@/server/workspace-access";
import { isAdministrator } from "@/server/team-access";
import { TeamManager } from "@/components/team/team-manager";
export const metadata = { title: "Team access" };
export default async function TeamPage() {
  const { user } = await workspaceContext();
  if (!isAdministrator(user.role)) forbidden();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-semibold">Team access</h1>
      <p className="mt-3 mb-8 text-sm text-muted-foreground">
        Invite people and manage workspace membership.
      </p>
      <TeamManager />
    </div>
  );
}
