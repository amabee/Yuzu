import Link from "next/link";
import { ArrowRight, CheckCheck, Settings2 } from "lucide-react";
import { headers } from "next/headers";
import { workspaceContext } from "@/server/workspace-access";
import { workspaceDashboard } from "@/server/dashboard-service";
import { WorkspaceDashboard } from "@/components/dashboard/workspace-dashboard";
export default async function OverviewPage() {
  const { user, workspace, workspaces } = await workspaceContext();
  const data = await workspaceDashboard(await headers());
  return (
    <div>
      <div className="workspace-breadcrumb">
        <span>Workspaces</span>
        <span>/</span>
        <span>{workspace?.name ?? "Overview"}</span>
      </div>
      <div className="workspace-page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl">Good work starts here.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            See what needs attention and how your team’s work is moving.
          </p>
        </div>
        <Link
          href="/boards"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm text-primary-foreground"
        >
          View boards
          <ArrowRight size={15} />
        </Link>
      </div>
      <WorkspaceDashboard
        principalId={user.id}
        initialData={data}
        workspaces={workspaces.map(({ id, name }) => ({ id, name }))}
      />
      <div className="workspace-quick-links">
        <Link href="/approvals">
          <CheckCheck size={20} />
          <div>
            <h2>Approvals</h2>
            <p>Keep decisions connected to the work.</p>
          </div>
          <ArrowRight size={16} />
        </Link>
        <Link href="/settings">
          <Settings2 size={20} />
          <div>
            <h2>Workspace settings</h2>
            <p>Shape the way your team works.</p>
          </div>
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
