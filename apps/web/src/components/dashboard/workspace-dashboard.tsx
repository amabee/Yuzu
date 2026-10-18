"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  CalendarDays,
  CheckCheck,
  CircleAlert,
  Columns3,
  FolderOpen,
  UsersRound,
} from "lucide-react";
import { Avatar } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  StatusIcon,
  formatDueDate,
} from "@/components/boards/board-presentation";
import { apiRequest } from "@/lib/api-client";
import { dashboardSchema, type Dashboard } from "@/lib/dashboard-contract";

export function WorkspaceDashboard({
  initialData,
  principalId,
  workspaces,
  projects = [],
}: {
  initialData: Dashboard;
  principalId: string;
  workspaces: { id: string; name: string }[];
  projects?: { id: string; name: string; workspaceId: string }[];
}) {
  const [workspaceId, setWorkspaceId] = useState("all");
  const [projectId, setProjectId] = useState("all");
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
      page,
    ],
    initialData:
      workspaceId === "all" && projectId === "all" && page === 1
        ? initialData
        : undefined,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (workspaceId !== "all") params.set("workspaceId", workspaceId);
      if (projectId !== "all") params.set("projectId", projectId);
      return dashboardSchema.parse(
        (
          await apiRequest(`/api/v1/dashboard?${params}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      );
    },
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
    deadlineTab === "upcoming" ? data?.upcomingCount : data?.overdue;
  return (
    <div className="space-y-6" aria-label="Workspace dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          A shared view of the work that needs your team.
        </p>
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
            className="w-full sm:w-64"
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
              className="w-full sm:w-56"
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
      {query.isError ? (
        <div role="alert" className="rounded-xl border bg-card p-6">
          <p className="text-sm">{query.error.message}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => void query.refetch()}
          >
            Reload overview
          </Button>
        </div>
      ) : !data ? (
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
      ) : (
        <>
          <dl
            aria-label="Task summary"
            className="grid grid-cols-2 gap-y-4 rounded-xl border bg-card p-5 sm:grid-cols-5 sm:divide-x sm:divide-border"
          >
            {[
              { key: "open", label: "Open tasks", value: data.open },
              { key: "completed", label: "Completed", value: data.completed },
              { key: "overdue", label: "Overdue", value: data.overdue },
              {
                key: "upcoming",
                label: "Due in 7 days",
                value: data.upcomingCount,
              },
              {
                key: "unassigned",
                label: "Unassigned",
                value: data.unassigned,
              },
            ].map((metric) => (
              <div
                key={metric.key}
                data-metric={metric.key}
                className="min-w-0 px-3"
              >
                <dt className="text-xs text-muted-foreground">
                  {metric.label}
                </dt>
                <dd
                  className={`mt-2 text-3xl font-semibold tabular-nums ${metric.key === "overdue" && metric.value ? "text-destructive" : "text-foreground"}`}
                >
                  {metric.value.toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section
              aria-label="Task deadlines"
              className="min-w-0 rounded-xl border bg-card"
            >
              <header className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <CalendarDays size={18} className="text-primary" />
                  On the calendar
                </h2>
                <div
                  className="flex gap-1"
                  role="group"
                  aria-label="Deadline filter"
                >
                  <Button
                    variant={deadlineTab === "upcoming" ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={deadlineTab === "upcoming"}
                    onClick={() => setDeadlineTab("upcoming")}
                  >
                    Upcoming
                  </Button>
                  <Button
                    variant={deadlineTab === "overdue" ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={deadlineTab === "overdue"}
                    onClick={() => setDeadlineTab("overdue")}
                  >
                    Overdue
                  </Button>
                </div>
              </header>
              <p className="px-5 pt-4 text-xs text-muted-foreground">
                {deadlineTab === "upcoming"
                  ? `${formatDueDate(data.calendarDate)} – ${formatDueDate(data.upcomingEnd)}. `
                  : "Earlier than today. "}
                {deadlineCount
                  ? `Showing ${deadlines!.length} of ${deadlineCount.toLocaleString()} tasks.`
                  : ""}
              </p>
              {deadlines?.length ? (
                <ul className="divide-y px-5">
                  {deadlines.map((task) => (
                    <li key={task.id}>
                      <Link
                        className="flex min-w-0 items-center justify-between gap-4 rounded-lg py-4 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary"
                        href={`/boards/${task.boardId}?task=${task.id}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {task.name}
                          </p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {task.workspaceName} / {task.boardName}
                          </p>
                        </div>
                        <span
                          className={`flex shrink-0 items-center gap-1.5 text-xs ${deadlineTab === "overdue" ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          <CalendarDays size={13} />
                          {formatDueDate(task.dueDate)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-6 py-12 text-center">
                  <CheckCheck size={26} className="mx-auto mb-3 text-primary" />
                  <h3 className="text-sm font-medium">
                    {deadlineTab === "overdue"
                      ? "Nothing overdue"
                      : "No deadlines in the next 7 days"}
                  </h3>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {deadlineTab === "overdue"
                      ? "Your team is up to date here."
                      : "Add target dates to tasks to see what is coming up."}
                  </p>
                </div>
              )}
            </section>
            <section
              aria-label="Assignee workload"
              className="min-w-0 rounded-xl border bg-card"
            >
              <header className="border-b p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <UsersRound size={18} className="text-primary" />
                  Who’s working on what
                </h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  Top 12 assignees by open tasks. Shared tasks count for each
                  person.
                </p>
              </header>
              {data.workload.length ? (
                <ul className="space-y-5 p-5">
                  {data.workload.map((person) => (
                    <li key={person.userId} className="flex items-start gap-3">
                      <Avatar.Root className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-xs font-semibold">
                        <Avatar.Image src={person.image ?? undefined} alt="" />
                        <Avatar.Fallback>
                          {person.name
                            .split(" ")
                            .slice(0, 2)
                            .map((part) => part[0])
                            .join("")}
                        </Avatar.Fallback>
                      </Avatar.Root>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-medium">
                            {person.name}
                          </p>
                          <span className="shrink-0 text-xs tabular-nums">
                            {person.count.toLocaleString()} open
                          </span>
                        </div>
                        <progress
                          aria-label={`${person.name}'s open tasks`}
                          value={person.count}
                          max={Math.max(1, data.workload[0].count)}
                          className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-secondary accent-primary [&::-webkit-progress-bar]:bg-secondary [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
                        />
                        {person.overdue > 0 && (
                          <p className="mt-1.5 flex items-center gap-1 text-xs text-destructive">
                            <CircleAlert size={11} />
                            {person.overdue.toLocaleString()} overdue
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-6 py-12 text-center">
                  <UsersRound
                    size={26}
                    className="mx-auto mb-3 text-muted-foreground"
                  />
                  <h3 className="text-sm font-medium">
                    No assigned open tasks
                  </h3>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Assign people to tasks to see how the work is shared.
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between border-t px-5 py-4 text-xs">
                <span className="text-muted-foreground">
                  Open tasks without an assignee
                </span>
                <strong className="tabular-nums">
                  {data.unassigned.toLocaleString()}
                </strong>
              </div>
            </section>
          </div>
          <section
            aria-label="Board status breakdown"
            className="rounded-xl border bg-card"
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Columns3 size={18} className="text-primary" />
                  Across your boards
                </h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  {data.total.toLocaleString()} active tasks across{" "}
                  {data.boardCount.toLocaleString()} boards.
                </p>
              </div>
              <Link
                href="/boards"
                className="text-xs font-medium text-primary hover:underline"
              >
                View boards
              </Link>
            </header>
            {data.boards.length ? (
              <div className="divide-y px-5">
                {data.boards.map((board) => (
                  <div
                    key={board.id}
                    className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
                  >
                    <Link
                      href={`/boards/${board.id}`}
                      className="min-w-0 self-center rounded focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <h3 className="truncate text-sm font-semibold hover:text-primary">
                        {board.name}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {board.workspaceName} / {board.total.toLocaleString()}{" "}
                        tasks
                        {board.overdue
                          ? ` / ${board.overdue.toLocaleString()} overdue`
                          : ""}
                      </p>
                    </Link>
                    <div className="min-w-0">
                      {board.total > 0 ? (
                        <>
                          <div
                            role="img"
                            aria-label={`Status distribution for ${board.name}: ${board.statuses.map((status) => `${status.label} ${status.count}`).join(", ")}`}
                            className="flex h-2 overflow-hidden rounded-full bg-secondary"
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
                          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                            {board.statuses.map((status) => (
                              <li
                                key={status.id ?? "__none__"}
                                className="flex items-center gap-1.5 text-xs"
                              >
                                <span
                                  style={{
                                    color:
                                      status.color ?? "var(--muted-foreground)",
                                  }}
                                >
                                  <StatusIcon icon={status.icon} size={12} />
                                </span>
                                <span className="text-muted-foreground">
                                  {status.label}
                                </span>
                                <span className="font-medium tabular-nums">
                                  {status.count.toLocaleString()}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="py-3 text-xs text-muted-foreground">
                          No active tasks on this board yet.
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-6 py-12 text-center">
                <FolderOpen
                  size={26}
                  className="mx-auto mb-3 text-muted-foreground"
                />
                <h3 className="text-sm font-medium">
                  No boards in this workspace
                </h3>
                <p className="mt-2 text-xs text-muted-foreground">
                  Create a board or ask an administrator for workspace access.
                </p>
              </div>
            )}
            {data.pageCount > 1 && (
              <nav
                aria-label="Dashboard board pages"
                className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs"
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
          <p className="text-xs leading-relaxed text-muted-foreground">
            The built-in Done status marks completion; custom statuses remain
            open. Archived tasks and pending approval requests are excluded.
            Dates use the installation timezone.
          </p>
        </>
      )}
    </div>
  );
}
