import Link from "next/link";
import { headers } from "next/headers";
import { LayoutGrid } from "lucide-react";
import { PageCrumbs } from "@/components/page-crumbs";
import { workspaceContext } from "@/server/workspace-access";
import { workspaceDashboard } from "@/server/dashboard-service";
import { approvalQueue } from "@/server/approval-service";
import {
  WorkspaceDashboard,
  type WaitingApproval,
} from "@/components/dashboard/workspace-dashboard";
import { visibleProjects } from "@/server/project-service";

const changeLabels: Record<string, string> = {
  name: "name",
  description: "description",
  checklist: "checklist",
  statusId: "status",
  priority: "priority",
  startDate: "start date",
  dueDate: "due date",
  groupId: "group",
  assigneeIds: "assignees",
  fieldValues: "fields",
};

function greeting(timezone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
  return hour < 12
    ? "Good morning"
    : hour < 18
      ? "Good afternoon"
      : "Good evening";
}

export default async function OverviewPage() {
  const { user, settings, workspace, workspaces } = await workspaceContext();
  const requestHeaders = await headers();
  const [data, queue, projects] = await Promise.all([
    workspaceDashboard(requestHeaders),
    approvalQueue(requestHeaders, "PENDING"),
    visibleProjects(user, {
      workspaceId: { in: workspaces.map((item) => item.id) },
      archived: false,
    }),
  ]);
  // Requests this person can decide, as the Approvals page lists them.
  const decidable = queue.proposals.filter(
    (proposal) => proposal.canDecide && proposal.authorId !== user.id,
  );
  const waiting: WaitingApproval[] = decidable.slice(0, 3).map((proposal) => ({
    id: proposal.id,
    authorName: proposal.authorName,
    taskName: proposal.name,
    boardName: proposal.boardName,
    operation: proposal.operation,
    changes: Object.keys(proposal.changes)
      .map((key) => changeLabels[key])
      .filter(Boolean),
  }));
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;
  const summary = [
    data.mine.upcoming
      ? `${data.mine.upcoming} of your ${data.mine.upcoming === 1 ? "tasks is" : "tasks are"} due this week`
      : "Nothing of yours is due this week",
    decidable.length
      ? `${decidable.length} ${decidable.length === 1 ? "approval is" : "approvals are"} waiting on you`
      : null,
  ]
    .filter(Boolean)
    .join(", and ");
  return (
    <div>
      <PageCrumbs
        items={[
          { label: workspace?.name ?? "Workspace" },
          { label: "Overview" },
        ]}
      />
      <header className="overview-hero">
        <div className="min-w-0">
          <h1>
            {greeting(settings.timezone)}, {firstName}.
          </h1>
          <p>{summary}.</p>
        </div>
        <Link href="/boards" className="overview-hero-link">
          <LayoutGrid size={16} />
          All boards
        </Link>
      </header>
      <WorkspaceDashboard
        principalId={user.id}
        initialData={data}
        waiting={waiting}
        waitingTotal={decidable.length}
        workspaces={workspaces.map(({ id, name }) => ({ id, name }))}
        projects={projects.map(({ id, name, workspaceId }) => ({
          id,
          name,
          workspaceId,
        }))}
      />
    </div>
  );
}
