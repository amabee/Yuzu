"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import {
  CalendarDays,
  Columns3,
  FolderOpen,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { formatDueDate } from "@/components/boards/board-presentation";
import { apiRequest } from "@/lib/api-client";
import {
  COMPLETED_STATUS_ID,
  dashboardSchema,
  type Dashboard,
} from "@/lib/dashboard-contract";

export type WaitingApproval = {
  id: string;
  authorName: string;
  taskName: string;
  boardName: string;
  operation: "CREATE" | "UPDATE" | "ARCHIVE";
  changes: string[];
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
// Stable avatar tones from the theme: each person keeps the same one.
const tone = (id: string) =>
  [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;

function Avatars({ people }: { people: { id: string; name: string }[] }) {
  if (!people.length) return null;
  return (
    <span
      className="overview-avatars"
      aria-label={people.map((p) => p.name).join(", ")}
    >
      {people.map((person) => (
        <span
          key={person.id}
          className="overview-avatar"
          data-tone={tone(person.id)}
          title={person.name}
          aria-hidden="true"
        >
          {initials(person.name)}
        </span>
      ))}
    </span>
  );
}

function dueLabel(dueDate: string, today: string) {
  if (dueDate < today) return { text: "Overdue", late: true };
  if (dueDate === today) return { text: "Today", late: false };
  const days =
    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
    86_400_000;
  if (days < 7)
    return {
      text: new Intl.DateTimeFormat("en", {
        weekday: "short",
        timeZone: "UTC",
      }).format(new Date(`${dueDate}T00:00:00Z`)),
      late: false,
    };
  return { text: formatDueDate(dueDate), late: false };
}

function approvalSummary(item: WaitingApproval) {
  if (item.operation === "CREATE") return "wants to add";
  if (item.operation === "ARCHIVE") return "wants to archive";
  return item.changes.length
    ? `wants to change the ${item.changes.slice(0, 2).join(" and ")} of`
    : "wants to change";
}

export function WorkspaceDashboard({
  initialData,
  principalId,
  workspaces,
  projects = [],
  waiting = [],
  waitingTotal = 0,
}: {
  initialData: Dashboard;
  principalId: string;
  workspaces: { id: string; name: string }[];
  projects?: { id: string; name: string; workspaceId: string }[];
  /** The first few approval requests this person can decide. */
  waiting?: WaitingApproval[];
  waitingTotal?: number;
}) {
  const [workspaceId, setWorkspaceId] = useState("all");
  const [projectId, setProjectId] = useState("all");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const projectChoices = projects.filter(
    (project) => workspaceId === "all" || project.workspaceId === workspaceId,
  );
  const [page, setPage] = useState(1);
  const [deadlineTab, setDeadlineTab] = useState<"upcoming" | "overdue">(
    "upcoming",
  );
  const query = useQuery({
    queryKey: [
      "principal",
      principalId,
      "dashboard",
      workspaceId,
      projectId,
      scope,
      page,
    ],
    initialData:
      workspaceId === "all" &&
      projectId === "all" &&
      scope === "all" &&
      page === 1
        ? initialData
        : undefined,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (workspaceId !== "all") params.set("workspaceId", workspaceId);
      if (projectId !== "all") params.set("projectId", projectId);
      if (scope !== "all") params.set("scope", scope);
      return dashboardSchema.parse(
        (
          await apiRequest(`/api/v1/dashboard?${params}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      );
    },
    placeholderData: (previous) => previous,
    staleTime: 0,
    retry: false,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const data = query.data;
  const deadlines =
    deadlineTab === "upcoming" ? data?.upcoming : data?.overdueTasks;
  const deadlineCount =
    deadlineTab === "upcoming"
      ? scope === "mine"
        ? data?.mine.upcoming
        : data?.upcomingCount
      : scope === "mine"
        ? data?.mine.overdue
        : data?.overdue;
  const filters = (
    <div className="overview-filters">
      <Select
        value={workspaceId}
        onValueChange={(value) => {
          setWorkspaceId(value);
          setProjectId("all");
          setPage(1);
        }}
      >
        <SelectTrigger
          aria-label="Dashboard workspace"
          className="w-full sm:w-52"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All workspaces</SelectItem>
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              {workspace.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {projectChoices.length > 0 && (
        <Select
          value={projectId}
          onValueChange={(value) => {
            setProjectId(value);
            setPage(1);
          }}
        >
          <SelectTrigger
            aria-label="Dashboard project"
            className="w-full sm:w-52"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects and boards</SelectItem>
            {projectChoices.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
  if (query.isError)
    return (
      <div className="space-y-5">
        {filters}
        <div role="alert" className="overview-card bg-card p-6">
          <p className="text-sm">{query.error.message}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => void query.refetch()}
          >
            Reload overview
          </Button>
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="space-y-5">
        {filters}
        <div
          role="status"
          aria-label="Loading dashboard"
          className="grid gap-4 sm:grid-cols-2"
        >
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  const metrics = [
    {
      key: "open",
      label: "Open tasks",
      value: data.open,
      note: `${data.mine.open.toLocaleString()} assigned to you`,
    },
    {
      key: "upcoming",
      label: "Due this week",
      value: data.upcomingCount,
      note: `${data.mine.upcoming.toLocaleString()} assigned to you`,
    },
    {
      key: "overdue",
      label: "Overdue",
      value: data.overdue,
      note: data.overdue ? "Needs attention" : "Nothing is late",
      alert: data.overdue > 0,
    },
    {
      key: "completed",
      label: "Completed",
      value: data.completed,
      note: "Marked Done",
    },
  ];
  const maxLoad = Math.max(1, data.workload[0]?.count ?? 0);
  return (
    <div className="space-y-5" aria-label="Workspace dashboard">
      {filters}
      <dl aria-label="Task summary" className="overview-metrics">
        {metrics.map((metric) => (
          <div key={metric.key} data-metric={metric.key}>
            <dt>{metric.label}</dt>
            <dd>{metric.value.toLocaleString()}</dd>
            <p data-alert={metric.alert || undefined}>{metric.note}</p>
          </div>
        ))}
      </dl>
      <div className="overview-grid">
        <div className="grid min-w-0 content-start gap-5">
          <section
            aria-label="Task deadlines"
            className="overview-card bg-card"
          >
            <header className="overview-card-head">
              <h2>
                <CalendarDays size={18} />
                Your week
              </h2>
              <div className="flex flex-wrap gap-2">
                <div
                  className="timeline-segment"
                  role="group"
                  aria-label="Deadline filter"
                >
                  <button
                    type="button"
                    aria-pressed={deadlineTab === "upcoming"}
                    onClick={() => setDeadlineTab("upcoming")}
                  >
                    Upcoming
                  </button>
                  <button
                    type="button"
                    aria-pressed={deadlineTab === "overdue"}
                    onClick={() => setDeadlineTab("overdue")}
                  >
                    Overdue
                  </button>
                </div>
                <div
                  className="timeline-segment"
                  role="group"
                  aria-label="Whose tasks"
                >
                  <button
                    type="button"
                    aria-pressed={scope === "mine"}
                    onClick={() => setScope("mine")}
                  >
                    Mine
                  </button>
                  <button
                    type="button"
                    aria-pressed={scope === "all"}
                    onClick={() => setScope("all")}
                  >
                    Everyone
                  </button>
                </div>
              </div>
            </header>
            <p className="overview-card-note">
              {deadlineTab === "upcoming"
                ? `${formatDueDate(data.calendarDate)} – ${formatDueDate(data.upcomingEnd)}. `
                : "Earlier than today. "}
              {deadlineCount
                ? `Showing ${deadlines!.length} of ${deadlineCount.toLocaleString()} tasks.`
                : ""}
            </p>
            {deadlines?.length ? (
              <ul className="overview-week">
                {deadlines.map((task) => {
                  const due = dueLabel(task.dueDate, data.calendarDate);
                  return (
                    <li key={task.id}>
                      <Link href={`/boards/${task.boardId}?task=${task.id}`}>
                        <span className="min-w-0">
                          <span className="overview-week-name">
                            {task.name}
                          </span>
                          <span className="overview-week-board">
                            {task.workspaceName} / {task.boardName}
                          </span>
                        </span>
                        {task.status && (
                          <span
                            className="overview-status"
                            data-done={
                              task.status.id === COMPLETED_STATUS_ID ||
                              undefined
                            }
                            style={
                              task.status.color
                                ? ({
                                    "--status": task.status.color,
                                  } as React.CSSProperties)
                                : undefined
                            }
                          >
                            {task.status.label}
                          </span>
                        )}
                        <span
                          className="overview-due"
                          data-late={due.late || undefined}
                        >
                          {due.text}
                        </span>
                        <Avatars people={task.assignees} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="overview-empty">
                <h3>
                  {deadlineTab === "overdue"
                    ? "Nothing overdue"
                    : "No deadlines in the next 7 days"}
                </h3>
                <p>
                  {deadlineTab === "overdue"
                    ? "Everything here is on schedule."
                    : "Add target dates to tasks to see what is coming up."}
                </p>
              </div>
            )}
          </section>
          <section
            aria-label="Board status breakdown"
            className="overview-card bg-card"
          >
            <header className="overview-card-head">
              <div>
                <h2>
                  <Columns3 size={18} />
                  Boards
                </h2>
                <p className="overview-card-sub">
                  {data.total.toLocaleString()} active tasks across{" "}
                  {data.boardCount.toLocaleString()} boards.
                </p>
              </div>
              <Link href="/boards" className="overview-link">
                View all
              </Link>
            </header>
            {data.boards.length ? (
              <div className="overview-boards">
                {data.boards.map((board) => {
                  const done =
                    board.statuses.find(
                      (status) => status.id === COMPLETED_STATUS_ID,
                    )?.count ?? 0;
                  const percent = board.total
                    ? Math.round((done / board.total) * 100)
                    : 0;
                  return (
                    <Link
                      key={board.id}
                      href={`/boards/${board.id}`}
                      className="overview-board"
                    >
                      <h3>{board.name}</h3>
                      {board.total > 0 ? (
                        <div
                          role="img"
                          aria-label={`Status distribution for ${board.name}: ${board.statuses.map((status) => `${status.label} ${status.count}`).join(", ")}`}
                          className="overview-board-bar"
                        >
                          {board.statuses
                            .filter((status) => status.count > 0)
                            .map((status) => (
                              <span
                                key={status.id ?? "__none__"}
                                style={{
                                  width: `${(status.count / board.total) * 100}%`,
                                  backgroundColor:
                                    status.color ?? "var(--primary)",
                                }}
                              />
                            ))}
                        </div>
                      ) : (
                        <div
                          className="overview-board-bar"
                          aria-hidden="true"
                        />
                      )}
                      <p>
                        {board.total
                          ? `${percent}% done, ${board.total.toLocaleString()} ${board.total === 1 ? "task" : "tasks"}`
                          : "No active tasks yet"}
                        {board.overdue ? (
                          <span className="overview-due" data-late>
                            {" "}
                            · {board.overdue.toLocaleString()} overdue
                          </span>
                        ) : null}
                      </p>
                      <span className="overview-board-space">
                        {board.workspaceName}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="overview-empty">
                <FolderOpen size={24} className="mx-auto mb-2" />
                <h3>No boards in this workspace</h3>
                <p>Create a board or ask an administrator for access.</p>
              </div>
            )}
            {data.pageCount > 1 && (
              <nav
                aria-label="Dashboard board pages"
                className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-xs"
              >
                <span>
                  Page {data.page} of {data.pageCount}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={query.isFetching || data.page <= 1}
                    onClick={() => setPage(data.page - 1)}
                  >
                    Previous boards
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={query.isFetching || data.page >= data.pageCount}
                    onClick={() => setPage(data.page + 1)}
                  >
                    Next boards
                  </Button>
                </div>
              </nav>
            )}
          </section>
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <section
            aria-label="Waiting on you"
            className="overview-card bg-card"
          >
            <header className="overview-card-head">
              <h2>
                <ShieldCheck size={18} />
                Waiting on you
              </h2>
              <Link href="/approvals" className="overview-link">
                Open queue
              </Link>
            </header>
            {waiting.length ? (
              <ul className="overview-approvals">
                {waiting.map((item) => (
                  <li key={item.id}>
                    <span
                      className="overview-avatar"
                      data-tone={tone(item.authorName)}
                      aria-hidden="true"
                    >
                      {initials(item.authorName)}
                    </span>
                    <div className="min-w-0">
                      <p>
                        <b>{item.authorName}</b> {approvalSummary(item)}{" "}
                        <b>{item.taskName}</b>
                        <span className="text-muted-foreground">
                          {" "}
                          on {item.boardName}
                        </span>
                      </p>
                      <span className="approval-tape">Approval needed</span>
                    </div>
                  </li>
                ))}
                {waitingTotal > waiting.length && (
                  <li className="overview-card-sub">
                    And {waitingTotal - waiting.length} more in the queue.
                  </li>
                )}
              </ul>
            ) : (
              <div className="overview-empty">
                <h3>No requests for you</h3>
                <p>Changes that need your approval will show up here.</p>
              </div>
            )}
          </section>
          <section
            aria-label="Assignee workload"
            className="overview-card bg-card"
          >
            <header className="overview-card-head">
              <div>
                <h2>
                  <UsersRound size={18} />
                  Team load
                </h2>
                <p className="overview-card-sub">
                  Open tasks per person. Shared tasks count for each.
                </p>
              </div>
            </header>
            {data.workload.length ? (
              <ul className="overview-load">
                {data.workload.map((person) => (
                  <li key={person.userId}>
                    <span
                      className="overview-avatar"
                      data-tone={tone(person.userId)}
                      aria-hidden="true"
                    >
                      {initials(person.name)}
                    </span>
                    <span className="truncate">{person.name}</span>
                    <progress
                      aria-label={`${person.name}'s open tasks`}
                      value={person.count}
                      max={maxLoad}
                    />
                    <span className="tabular-nums">
                      {person.count.toLocaleString()}
                      {person.overdue > 0 && (
                        <span className="overview-due" data-late>
                          {" "}
                          ({person.overdue} late)
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="overview-empty">
                <h3>No assigned open tasks</h3>
                <p>Assign people to tasks to see how the work is shared.</p>
              </div>
            )}
            <div className="overview-card-foot">
              <span>Open tasks without an assignee</span>
              <strong className="tabular-nums">
                {data.unassigned.toLocaleString()}
              </strong>
            </div>
          </section>
          {data.overdue === 0 && data.total > 0 && (
            <section className="overview-caught-up" aria-label="All caught up">
              <Image src="/logo.svg" alt="" width={44} height={44} />
              <div>
                <h2>All caught up</h2>
                <p>Nothing here is overdue. Nice work.</p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
