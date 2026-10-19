import Link from "next/link";
import { forbidden } from "next/navigation";
import { workspaceContext } from "@/server/workspace-access";
import { isAdministrator } from "@/server/team-access";
import { TeamManager } from "@/components/team/team-manager";
import { PeopleManager } from "@/components/team/people-manager";
export const metadata = { title: "Team access" };
export default async function TeamPage() {
  const { user } = await workspaceContext();
  if (!isAdministrator(user.role)) forbidden();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/settings" className="text-xs text-muted-foreground">
        ← Settings
      </Link>
      <h1 className="mt-3 text-3xl font-semibold">Team access</h1>
      <p className="mt-3 mb-8 text-sm text-muted-foreground">
        Invite people, choose who administers Yuzu, and turn off access for
        people who leave.
      </p>
      <PeopleManager currentUserId={user.id} />
      <h2 className="mt-12 mb-1 text-xl font-semibold">Workspace membership</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Invite people to a workspace and manage who belongs to it.
      </p>
      <TeamManager />
    </div>
  );
}
