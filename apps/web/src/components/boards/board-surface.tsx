"use client";
import { ExportCsv } from "./export-csv";
import { ImportCsv } from "./import-csv";
import { matchesBoardView } from "@/lib/board-view";
import { mergeBoardState } from "@/lib/board-cache";
import { VirtualTaskList, VirtualTableBody } from "./virtual-task-list";
import { BoardFilters, BoardFilterSelect } from "./board-filters";
import { SavedViewControls } from "./saved-view-controls";
import {
  defaultViewConfig,
  type ViewConfig,
  type SavedView,
} from "@/lib/saved-view-contract";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/api-client";
import {
  readBoardState,
  saveTaskUpdate,
  type TaskChanges,
} from "@/lib/task-sync";
import {
  coreKeys,
  type BoardState,
  type BoardTask,
  type BoardField,
} from "@/lib/board-contract";
import { OperationToast, type BoardNotice } from "./operation-toast";
import { TaskEditor } from "./task-editor";
import { useTaskUploads } from "./use-task-uploads";
import { BoardManagement } from "./board-management";
import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { needsApproval } from "@/lib/approval-rules";
import { taskMutationResultSchema } from "@/lib/approval-contract";
import { useBoardLiveSync } from "./use-board-live-sync";
import {
  AssigneeAvatars,
  StatusIcon,
  optionBadgeStyle,
  formatDueDate,
  priorityOptions,
} from "./board-presentation";
import {
  Columns3,
  Table2,
  SlidersHorizontal,
  Info,
  ListChecks,
  Layers3,
  UserRound,
  CalendarDays,
  GanttChart,
  Hourglass,
  GripVertical,
  Archive,
  MessageSquare,
  Flag,
} from "lucide-react";
import { BoardCalendarView } from "./board-calendar";
import { PauseLeaf, PauseSlice } from "@/components/pause/decor";
import { BoardTimelineView } from "./board-timeline";
import { timelineWindow } from "@/lib/timeline-contract";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

type BoardInfo = {
  workspace: string;
  creator: string;
  createdAt: string;
  groups: string[];
};
export function BoardSurface({
  name,
  statuses: initialStatuses,
  initialState,
  initialTaskId,
  initialCommentsTab,
  initialViewId,
  initialLayout,
  calendar,
  group,
  info,
}: {
  initialState: BoardState;
  initialTaskId?: string;
  initialCommentsTab?: boolean;
  /** From `?view=`: open this saved view instead of the remembered one. */
  initialViewId?: string;
  /** From `?layout=`: show this layout for this visit. */
  initialLayout?: ViewConfig["layout"];
  /** Installation calendar settings and the month from `?month=`. */
  calendar: {
    today: string;
    weekStartsOn: 0 | 1;
    month?: string;
    /** First visible day of the timeline, from `?from=`. */
    timelineFrom?: string;
  };
  name: string;
  fields: { id: string; name: string; type?: string }[];
  statuses: string[];
  group: string;
  info?: BoardInfo;
}) {
  const router = useRouter();
  const clearTaskLink = () => {
    if (!initialTaskId) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("task");
    url.searchParams.delete("tab");
    router.replace(url.pathname + url.search, { scroll: false });
  };
  const [notice, setNotice] = useState<BoardNotice | null>(null);
  const [pendingTransfers, setPendingTransfers] = useState<
    Record<string, BoardNotice>
  >({});
  const transferNotice = (update: BoardNotice) => {
    setPendingTransfers((current) => {
      const next = { ...current };
      if (
        update.kind === "loading" &&
        (update.icon === "upload" || update.icon === "download")
      )
        next[update.id] = update;
      else delete next[update.id];
      return next;
    });
    setNotice(update);
  };
  const uploads = useTaskUploads(
    initialState.currentUserId,
    initialState.boardId,
    transferNotice,
  );
  const taskSheetRef = useRef<HTMLDivElement>(null);
  const notify = (message: string, kind: BoardNotice["kind"]) =>
    setNotice({ id: crypto.randomUUID(), message, kind });
  const queryClient = useQueryClient();
  const linkedView = initialState.savedViews?.find(
    (view) => view.id === initialViewId,
  );
  const initialView =
    linkedView ??
    initialState.savedViews?.find(
      (view) => view.id === initialState.selectedViewId,
    ) ??
    null;
  const [activeView, setActiveView] = useState<SavedView | null>(initialView);
  const [viewConfig, setViewConfig] = useState<ViewConfig>({
    // A linked view replaces the server's first page config; the query then
    // refetches with the linked filters.
    ...((linkedView ? linkedView.config : initialState.pagination?.config) ??
      initialView?.config ??
      defaultViewConfig),
    ...(initialLayout ? { layout: initialLayout } : {}),
    ...(initialTaskId
      ? {
          archived: Boolean(
            (
              initialState.focusedTask ??
              initialState.tasks.find((task) => task.id === initialTaskId)
            )?.archivedAt,
          ),
        }
      : {}),
  });
  const [selectedId, setSelectedId] = useState<string | null>(
    Boolean(initialTaskId) &&
      (initialState.focusedTask?.id === initialTaskId ||
        initialState.tasks.some((task) => task.id === initialTaskId))
      ? initialTaskId!
      : null,
  );
  const [requestConfig, setRequestConfig] = useState(viewConfig);
  useEffect(() => {
    const timer = setTimeout(() => setRequestConfig(viewConfig), 200);
    return () => clearTimeout(timer);
  }, [viewConfig]);
  const configKey = JSON.stringify(requestConfig);
  const [pageRequest, setPageRequest] = useState({ configKey, page: 1 });
  const page = pageRequest.configKey === configKey ? pageRequest.page : 1;
  const boardKey = [
    "principal",
    initialState.currentUserId,
    "boards",
    initialState.boardId,
  ];
  const queryKey = [...boardKey, "page", requestConfig, page, selectedId];
  const live = useBoardLiveSync(
    initialState.boardId,
    initialState.currentUserId,
  );
  const query = useQuery({
    queryKey,
    initialData:
      page === 1 &&
      selectedId === (initialTaskId ?? null) &&
      JSON.stringify(requestConfig) ===
        JSON.stringify(initialState.pagination?.config ?? defaultViewConfig)
        ? initialState
        : undefined,
    placeholderData: (previous) => previous,
    queryFn: ({ signal }) =>
      readBoardState(initialState.boardId, signal, {
        config: requestConfig,
        page,
        ...(selectedId ? { taskId: selectedId } : {}),
      }),
    staleTime: 0,
    refetchInterval: (current) => {
      const error = current.state.error;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status))
        return false;
      return queryClient.isMutating({ mutationKey: boardKey })
        ? false
        : live.syncInterval;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: () =>
      queryClient.isMutating({ mutationKey: boardKey }) ? false : "always",
    refetchOnReconnect: () =>
      queryClient.isMutating({ mutationKey: boardKey }) ? false : "always",
  });
  const state = query.data ?? initialState;
  const fields = state.fields;
  const savedStatuses =
    state.fields.find((field) => field.key === "status")?.options ?? [];
  const configureView = <K extends keyof ViewConfig>(
    key: K,
    value: ViewConfig[K],
  ) => setViewConfig((current) => ({ ...current, [key]: value }));
  const archived = viewConfig.archived;
  const setArchived = (value: boolean) => configureView("archived", value);
  const activeGroupFilter = viewConfig.groupId ?? "";
  const setGroupFilter = (value: string) =>
    configureView("groupId", value || null);
  const statusFilter = viewConfig.statusId ?? "";
  const missingReferences = Boolean(
    (activeGroupFilter &&
      !state.groups.some((group) => group.id === activeGroupFilter)) ||
    (statusFilter &&
      statusFilter !== "__none__" &&
      !savedStatuses.some((status) => status.id === statusFilter)),
  );
  const [selectedTab, setSelectedTab] = useState<"details" | "comments">(
    initialCommentsTab ? "comments" : "details",
  );
  const [creating, setCreating] = useState(false);
  const linkKey = `${initialTaskId ?? ""}:${Boolean(initialCommentsTab)}`;
  const [previousLink, setPreviousLink] = useState(linkKey);
  // Next keeps this board mounted when a search/notification links to another task.
  // Synchronize the changed route during render so uploads and board filters survive.
  if (previousLink !== linkKey) {
    setPreviousLink(linkKey);
    const task =
      initialState.focusedTask ??
      initialState.tasks.find((task) => task.id === initialTaskId);
    setSelectedId(
      initialTaskId && task?.id === initialTaskId ? initialTaskId : null,
    );
    setSelectedTab(initialCommentsTab ? "comments" : "details");
    setCreating(false);
    if (initialTaskId && task)
      setViewConfig((current) => ({
        ...current,
        archived: Boolean(task.archivedAt),
      }));
  }
  const tasks = state.tasks.filter((task) =>
    matchesBoardView(
      task,
      viewConfig,
      state.currentUserId,
      state.calendarDate ?? new Date().toISOString().slice(0, 10),
    ),
  );
  const total = state.pagination?.total ?? tasks.length;
  const totalForStatus = (status: string) =>
    state.pagination?.statusCounts[
      savedStatuses.find((option) => option.label === status)?.id ?? "__none__"
    ] ?? tasks.filter((task) => statusLabel(task) === status).length;
  let emptyStatusLabel = savedStatuses.length ? "No status" : group;
  while (savedStatuses.some((option) => option.label === emptyStatusLabel))
    emptyStatusLabel += " (unassigned)";
  const statusLabel = (task: BoardTask) =>
    savedStatuses.find((option) => option.id === task.statusId)?.label ??
    emptyStatusLabel;
  const statuses = savedStatuses.length
    ? [
        ...savedStatuses.map((option) => option.label),
        ...(statusFilter === "__none__" ||
        (state.pagination?.statusCounts.__none__ ?? 0) > 0 ||
        tasks.some((task) => !task.statusId)
          ? [emptyStatusLabel]
          : []),
      ]
    : initialStatuses;
  const mutation = useMutation({
    mutationKey: boardKey,
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    mutationFn: ({
      action,
      input,
      base,
    }: {
      action: string;
      input: unknown;
      base?: BoardTask;
    }) =>
      action === "update" && base
        ? saveTaskUpdate(
            state.boardId,
            input as { taskId: string; revision: number; changes: TaskChanges },
            base,
          )
        : apiRequest(
            action === "approval-policy"
              ? "/api/v1/approvals/configure"
              : `/api/v1/boards/${action}`,
            {
              method: "POST",
              json: input,
            },
          ),
    onSuccess: async (_result, variables) => {
      const result = taskMutationResultSchema.safeParse(_result.data);
      const pendingApproval =
        result.success && result.data.outcome === "PENDING_APPROVAL";
      let refreshError: Error | null = null;
      try {
        const targetId = result.success
          ? result.data.taskId
          : (variables.input as { taskId?: string }).taskId;
        const fresh = await readBoardState(state.boardId, undefined, {
          config: requestConfig,
          page,
          ...(targetId ? { taskId: targetId } : {}),
        });
        queryClient.setQueryData(queryKey, fresh);
        queryClient.setQueriesData<BoardState>(
          { queryKey: boardKey },
          (current) => current && mergeBoardState(current, fresh),
        );
      } catch (error) {
        refreshError =
          error instanceof Error
            ? error
            : new Error("Could not refresh the board.");
      }
      if (
        ["create-task", "update", "archive", "restore", "editor"].includes(
          variables.action,
        )
      ) {
        setCreating(false);
        setSelectedId(null);
        clearTaskLink();
      }
      const labels: Record<string, string> = {
        "approval-policy": "Approval settings saved",
        "create-task": "Task created",
        update: "Task updated",
        archive: "Task archived",
        restore: "Task restored",
        editor: "Task permissions updated",
        field: "Custom field added",
        group: "Group added",
        "configure-field": "Field saved",
        "remove-field": "Field removed",
        "rename-group": "Group renamed",
        "remove-group": "Group removed",
        manager: "Board managers updated",
      };
      notify(
        refreshError
          ? "Change saved, but the board could not refresh. Try opening it again."
          : pendingApproval
            ? variables.action === "create-task"
              ? "Task creation sent for approval"
              : variables.action === "archive"
                ? "Archive request sent for approval"
                : "Changes sent for approval"
            : (labels[variables.action] ?? "Change saved"),
        refreshError ? "error" : pendingApproval ? "info" : "success",
      );
    },
    onError: async (error) => {
      notify(error.message, "error");
      await query.refetch();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: boardKey }),
  });
  const act = (action: string, input: unknown, base?: BoardTask) => {
    if (!mutation.isPending && !inlineMutation.isPending) {
      inlineMutation.reset();
      mutation.mutate({
        action,
        input:
          action === "archive"
            ? {
                ...(input as Record<string, unknown>),
                requestKey: crypto.randomUUID(),
              }
            : input,
        base,
      });
    }
  };
  // Inline changes update the shared table/Kanban cache before waiting for the network.
  // Cancel older reads so they cannot overwrite a move that is still being saved.
  const inlineMutation = useMutation({
    mutationKey: boardKey,
    mutationFn: async ({
      task,
      changes,
    }: {
      task: BoardTask;
      changes: Partial<
        Pick<BoardTask, "statusId" | "priority" | "startDate" | "dueDate">
      >;
    }) => {
      const result = await saveTaskUpdate(
        state.boardId,
        { taskId: task.id, revision: task.revision, changes },
        task,
      );
      return taskMutationResultSchema.parse(result.data);
    },
    onMutate: async ({ task, changes }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<BoardState>(queryKey);
      if (!needsApproval(state.approvalPolicy, "UPDATE", changes, state.fields))
        queryClient.setQueryData<BoardState>(
          queryKey,
          (current) =>
            current && {
              ...current,
              tasks: current.tasks.map((item) =>
                item.id === task.id ? { ...item, ...changes } : item,
              ),
            },
        );
      return { previous };
    },
    onSuccess: (result, variables, context) => {
      if (result.outcome === "PENDING_APPROVAL") {
        if (context?.previous)
          queryClient.setQueryData(queryKey, context.previous);
        notify("Changes sent for approval", "info");
        return;
      }
      notify("Task updated", "success");
      const update = (task: BoardTask) =>
        task.id === result.taskId && task.revision <= result.revision
          ? { ...task, ...variables.changes, revision: result.revision }
          : task;
      queryClient.setQueriesData<BoardState>(
        { queryKey: boardKey },
        (current) =>
          current && {
            ...current,
            tasks: current.tasks.map(update),
            focusedTask: current.focusedTask
              ? update(current.focusedTask)
              : current.focusedTask,
          },
      );
    },
    onError: (error, _variables, context) => {
      notify(error.message, "error");
      if (context?.previous)
        queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: boardKey });
    },
  });
  const busy = mutation.isPending || inlineMutation.isPending;
  const patch = (
    task: BoardTask,
    changes: Partial<
      Pick<BoardTask, "statusId" | "priority" | "startDate" | "dueDate">
    >,
  ) => {
    if (!busy) inlineMutation.mutate({ task, changes });
  };
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState<string | null>(null);
  const selected =
    state.tasks.find((task) => task.id === selectedId) ??
    (state.focusedTask?.id === selectedId ? state.focusedTask : undefined);
  const selectedChoices = (task: BoardTask, fieldId: string) => {
    const value = task.fieldValues[fieldId];
    return Array.isArray(value) ? value : [];
  };
  const formatCustom = (task: BoardTask, field: BoardField) => {
    const value = task.fieldValues[field.id];
    if (value == null) return "—";
    if (field.type === "PEOPLE")
      return (Array.isArray(value) ? value : [])
        .map(
          (id) =>
            state.people.find((person) => person.id === id)?.name ??
            "Former member",
        )
        .join(", ");
    if (field.options.length)
      return (Array.isArray(value) ? value : [String(value)])
        .map(
          (id) => field.options.find((option) => option.id === id)?.label ?? id,
        )
        .join(", ");
    return Array.isArray(value)
      ? value.join(", ")
      : typeof value === "boolean"
        ? value
          ? "Yes"
          : "No"
        : String(value);
  };
  const view = viewConfig.layout;
  // Keep the URL shareable: the board id stays the same across layouts.
  // Phones default the timeline to Months; saved views keep their own zoom.
  const narrow = useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia("(max-width: 640px)");
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia("(max-width: 640px)").matches,
    () => false,
  );
  const timelineSettings = viewConfig.timeline ?? {
    groupBy: "group" as const,
    zoom: narrow ? ("months" as const) : ("weeks" as const),
  };
  // null keeps the window around today for the current zoom.
  const [timelineFrom, setTimelineFrom] = useState<string | null>(
    calendar.timelineFrom ?? null,
  );
  const [calendarMonth, setCalendarMonth] = useState(
    calendar.month ?? calendar.today.slice(0, 7),
  );
  const [createDueDate, setCreateDueDate] = useState<string | undefined>();
  const linkView = (changes: {
    layout?: string;
    view?: string | null;
    month?: string;
    from?: string | null;
  }) => {
    const url = new URL(window.location.href);
    if (changes.from === null) url.searchParams.delete("from");
    else if (changes.from) url.searchParams.set("from", changes.from);
    if (changes.month) url.searchParams.set("month", changes.month);
    if (changes.layout) url.searchParams.set("layout", changes.layout);
    if (changes.view === null) url.searchParams.delete("view");
    else if (changes.view) url.searchParams.set("view", changes.view);
    window.history.replaceState(null, "", url.pathname + url.search);
  };
  const setView = (value: ViewConfig["layout"]) => {
    configureView("layout", value);
    linkView({ layout: value === "board" ? "kanban" : value });
  };
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const visibleStatuses = (statuses.length ? statuses : [group]).filter(
    (status) =>
      !statusFilter ||
      (statusFilter === "__none__"
        ? status === emptyStatusLabel
        : savedStatuses.find((option) => option.id === statusFilter)?.label ===
          status),
  );
  return (
    <section className="board-surface" data-connection={live.status}>
      <OperationToast
        notice={notice}
        pinnedNotices={Object.values(pendingTransfers)}
      />
      <SavedViewControls
        views={state.savedViews ?? []}
        active={activeView}
        config={viewConfig}
        userId={state.currentUserId}
        canManage={state.canManage}
        boardId={state.boardId}
        onApply={(view, config) => {
          setActiveView(view);
          setViewConfig(config);
          linkView({
            view: view?.id ?? null,
            layout: config.layout === "board" ? "kanban" : config.layout,
          });
        }}
        onRefresh={() => query.refetch()}
        notify={notify}
      />
      {missingReferences && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          This view uses a removed group or status. Choose a current filter and
          save the view again.
        </p>
      )}
      <div className="board-view-tabs" aria-label="Board view">
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={view === "board"}
          onClick={() => setView("board")}
        >
          <Columns3 size={16} />
          Kanban
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={view === "table"}
          onClick={() => setView("table")}
        >
          <Table2 size={16} />
          Table
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={view === "calendar"}
          onClick={() => setView("calendar")}
        >
          <CalendarDays size={16} />
          Calendar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={view === "timeline"}
          onClick={() => setView("timeline")}
        >
          <GanttChart size={16} />
          Timeline
        </Button>
      </div>
      {(state.pendingApprovalCount ?? state.pendingApprovals.length) > 0 && (
        <div className="approval-banner">
          <span>
            {state.pendingApprovalCount ?? state.pendingApprovals.length}{" "}
            pending approval{" "}
            {(state.pendingApprovalCount ?? state.pendingApprovals.length) === 1
              ? "request"
              : "requests"}
            . Current task values stay unchanged.
          </span>
          <Link
            className="shrink-0 font-medium text-primary underline-offset-4 hover:underline"
            href="/approvals"
          >
            Review requests
          </Link>
        </div>
      )}
      <div className="board-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <BoardFilterSelect
            label="Filter task group"
            value={activeGroupFilter}
            onChange={setGroupFilter}
            className="w-44 max-w-full"
            options={[
              { value: "", label: "All groups" },
              ...(activeGroupFilter &&
              !state.groups.some((group) => group.id === activeGroupFilter)
                ? [{ value: activeGroupFilter, label: "Removed group" }]
                : []),
              ...state.groups.map((group) => ({
                value: group.id,
                label: group.name,
              })),
            ]}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-[40px]"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen(!filterOpen)}
          >
            <SlidersHorizontal size={14} />
            Filter
            {(statusFilter ||
              viewConfig.search ||
              viewConfig.assignee !== "all" ||
              viewConfig.priority !== "all" ||
              viewConfig.due !== "all") && (
              <span className="size-1.5 rounded-full bg-primary" />
            )}
          </Button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{total} tasks</span>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              mutation.reset();
              setSelectedTab("details");
              setCreateDueDate(undefined);
              setCreating(true);
            }}
          >
            Add task
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={archived}
            onClick={() => setArchived(!archived)}
          >
            {archived ? "Active tasks" : "Archived"}
          </Button>
          <ImportCsv
            state={state}
            onNotice={transferNotice}
            onChanged={() => {
              void queryClient.invalidateQueries({ queryKey });
            }}
          />
          <ExportCsv
            boardId={state.boardId}
            config={viewConfig}
            count={total}
            onNotice={transferNotice}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDetailsOpen(true);
            }}
          >
            <Info size={15} />
            <span>Board details</span>
          </Button>
        </div>
      </div>
      {mutation.error && !selected && !creating && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      {inlineMutation.error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {inlineMutation.error.message}
        </p>
      )}
      {query.error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          Could not refresh the board. {query.error.message}
        </p>
      )}
      {filterOpen && (
        <BoardFilters
          config={viewConfig}
          statuses={savedStatuses}
          priorities={priorityOptions(state)}
          groupActive={!!activeGroupFilter}
          count={total}
          onChange={setViewConfig}
          hideDue={view === "calendar" || view === "timeline"}
        />
      )}
      {view === "timeline" ? (
        <BoardTimelineView
          boardKey={boardKey}
          boardId={state.boardId}
          config={requestConfig}
          zoom={timelineSettings.zoom}
          groupBy={timelineSettings.groupBy}
          onSettings={(settings) => {
            if (settings.zoom !== timelineSettings.zoom) {
              setTimelineFrom(null);
              linkView({ from: null });
            }
            configureView("timeline", settings);
          }}
          from={
            timelineFrom ??
            timelineWindow(
              calendar.today,
              timelineSettings.zoom,
              calendar.weekStartsOn,
            ).from
          }
          onWindowChange={(from) => {
            setTimelineFrom(from);
            linkView({ from });
          }}
          today={calendar.today}
          weekStartsOn={calendar.weekStartsOn}
          statuses={savedStatuses}
          groups={state.groups}
          people={state.people}
          pending={busy}
          onOpen={(taskId) => {
            setSelectedTab("details");
            setSelectedId(taskId);
          }}
          onChange={(task, dates) => patch(task, dates)}
        />
      ) : view === "calendar" ? (
        <BoardCalendarView
          boardKey={boardKey}
          boardId={state.boardId}
          config={requestConfig}
          month={calendarMonth}
          today={calendar.today}
          weekStartsOn={calendar.weekStartsOn}
          onMonthChange={(month) => {
            setCalendarMonth(month);
            linkView({ month });
          }}
          statuses={savedStatuses}
          people={state.people}
          pending={busy}
          onOpen={(taskId) => {
            setSelectedTab("details");
            setSelectedId(taskId);
          }}
          onMove={(task, dueDate) => patch(task, { dueDate })}
          onCreate={(dueDate) => {
            mutation.reset();
            setSelectedTab("details");
            setCreateDueDate(dueDate);
            setCreating(true);
          }}
        />
      ) : view === "board" ? (
        <div className="board-lanes-scroll">
          <div
            className="board-lanes"
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, visibleStatuses.length)}, minmax(220px, 1fr))`,
            }}
          >
            {visibleStatuses.map((status, index) => (
              <section
                className={`board-lane ${dropStatus === status ? "board-lane-drop" : ""}`}
                key={status}
                onDragOver={(event) => {
                  if (!archived && draggingId && !busy) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropStatus(status);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const task = tasks.find(
                    (task) =>
                      task.id === event.dataTransfer.getData("text/plain"),
                  );
                  setDraggingId(null);
                  setDropStatus(null);
                  if (
                    task?.canEdit &&
                    !archived &&
                    !busy &&
                    statusLabel(task) !== status
                  )
                    patch(task, {
                      statusId:
                        savedStatuses.find((option) => option.label === status)
                          ?.id ?? null,
                    });
                }}
                style={
                  {
                    "--lane-tone":
                      savedStatuses.find((option) => option.label === status)
                        ?.color ??
                      `color-mix(in srgb, var(--primary) ${90 - (index % 4) * 15}%, var(--muted-foreground))`,
                  } as React.CSSProperties
                }
              >
                <header className="board-lane-header">
                  <StatusIcon
                    icon={
                      savedStatuses.find((option) => option.label === status)
                        ?.icon
                    }
                  />
                  <h2>{status}</h2>
                  <span className="board-lane-count">
                    {totalForStatus(status)}
                  </span>
                </header>
                <VirtualTaskList
                  items={tasks.filter((task) => statusLabel(task) === status)}
                  pinnedId={draggingId}
                >
                  {(task) => (
                    <article
                      key={task.id}
                      data-task-id={task.id}
                      className="task-card"
                      draggable={task.canEdit && !busy}
                      onDragStart={(event) => {
                        if (
                          (event.target as HTMLElement).closest(
                            "select,input,textarea,[data-no-drag]",
                          )
                        ) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.setData("text/plain", task.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setDragImage(
                          event.currentTarget,
                          24,
                          24,
                        );
                        setDraggingId(task.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDropStatus(null);
                      }}
                      onClick={(event) => {
                        if (
                          (event.target as HTMLElement).closest(
                            "button,select,a,input,textarea",
                          )
                        )
                          return;
                        mutation.reset();
                        setSelectedTab("details");
                        setSelectedId(task.id);
                      }}
                      aria-busy={
                        inlineMutation.isPending &&
                        inlineMutation.variables?.task.id === task.id
                      }
                    >
                      <div className="task-card-actions">
                        {task.canEdit && (
                          <button
                            type="button"
                            className="task-drag-handle"
                            aria-label={`Drag ${task.name}`}
                            title="Drag task to another status"
                            disabled={busy}
                          >
                            <GripVertical size={16} />
                          </button>
                        )}
                        {task.canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`${state.approvalPolicy.enabled && state.approvalPolicy.requireArchive ? "Request archive for" : "Archive"} ${task.name}`}
                            title="Archive task"
                            disabled={busy}
                            data-no-drag
                            onClick={() =>
                              act("archive", {
                                taskId: task.id,
                                revision: task.revision,
                              })
                            }
                          >
                            <Archive size={14} />
                          </Button>
                        )}
                      </div>
                      <div className="task-card-heading">
                        <button
                          className="task-card-title"
                          onClick={() => {
                            mutation.reset();
                            setSelectedTab("details");
                            setSelectedId(task.id);
                          }}
                        >
                          {task.name}
                        </button>
                        {task.dueDate && (
                          <span className="task-card-target-date">
                            <span
                              className="task-title-divider"
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <time
                              className="task-card-date"
                              dateTime={task.dueDate}
                              title={`Target date: ${formatDueDate(task.dueDate, true)}`}
                            >
                              <CalendarDays size={12} />
                              {formatDueDate(task.dueDate)}
                            </time>
                          </span>
                        )}
                      </div>
                      {state.pendingApprovals.some(
                        (proposal) => proposal.taskId === task.id,
                      ) && (
                        <Link className="task-card-pending" href="/approvals">
                          <Hourglass size={12} aria-hidden="true" />
                          Awaiting approval
                        </Link>
                      )}
                      <div className="task-card-tags">
                        <span
                          style={optionBadgeStyle(
                            priorityOptions(state).find(
                              (option) => option.id === task.priority,
                            ),
                          )}
                        >
                          <Flag size={11} />
                          {priorityOptions(state).find(
                            (option) => option.id === task.priority,
                          )?.label ?? task.priority}
                        </span>
                        {task.groupId && (
                          <span title="Task group">
                            {
                              state.groups.find(
                                (item) => item.id === task.groupId,
                              )?.name
                            }
                          </span>
                        )}
                      </div>
                      <div className="task-card-tags task-custom-tags">
                        {state.fields
                          .filter(
                            (field) =>
                              !coreKeys.includes(field.key) &&
                              field.type !== "MULTI_SELECT",
                          )
                          .flatMap((field) => {
                            const value = task.fieldValues[field.id];
                            if (
                              value == null ||
                              value === "" ||
                              (Array.isArray(value) && !value.length)
                            )
                              return [];
                            const labels =
                              field.type === "TAGS" && Array.isArray(value)
                                ? value.map(
                                    (id) =>
                                      field.options.find(
                                        (option) => option.id === id,
                                      )?.label ?? id,
                                  )
                                : [formatCustom(task, field)];
                            return labels.map((label) => (
                              <span
                                key={`${field.id}-${label}`}
                                title={`${field.name}: ${label}`}
                                style={
                                  field.type === "TAGS"
                                    ? optionBadgeStyle(
                                        field.options.find(
                                          (option) => option.label === label,
                                        ),
                                      )
                                    : undefined
                                }
                              >
                                {field.type !== "TAGS" && <b>{field.name}: </b>}
                                {label}
                              </span>
                            ));
                          })}
                      </div>
                      {state.fields
                        .filter(
                          (field) =>
                            field.type === "MULTI_SELECT" &&
                            selectedChoices(task, field.id).length > 0,
                        )
                        .map((field) => (
                          <div
                            className="task-checklist-summary"
                            key={field.id}
                            title={formatCustom(task, field)}
                          >
                            <ListChecks size={13} />
                            <span>{field.name}</span>
                            <span>
                              {selectedChoices(task, field.id).length}/
                              {field.options.length}
                            </span>
                          </div>
                        ))}
                      {task.checklist.length > 0 && (
                        <div
                          className="task-checklist-summary"
                          aria-label={`Checklist progress for ${task.name}`}
                        >
                          <ListChecks size={13} />
                          <span>Checklist</span>
                          <span>
                            {task.checklist.filter((item) => item.done).length}/
                            {task.checklist.length}
                          </span>
                        </div>
                      )}
                      {task.description && (
                        <p className="task-card-description">
                          {task.description}
                        </p>
                      )}
                      <div className="task-card-bottom">
                        <AssigneeAvatars
                          ids={task.assigneeIds}
                          people={state.people}
                        />
                        <button
                          type="button"
                          className="task-comment-count"
                          aria-label={`Comments for ${task.name}`}
                          onClick={() => {
                            mutation.reset();
                            setSelectedTab("comments");
                            setSelectedId(task.id);
                          }}
                        >
                          <MessageSquare size={13} />
                          {task.commentCount ?? 0}
                        </button>
                      </div>
                    </article>
                  )}
                </VirtualTaskList>
                {!tasks.some((task) => statusLabel(task) === status) && (
                  <div className="board-lane-empty">
                    <div
                      className="board-empty-illustration"
                      aria-hidden="true"
                    >
                      <span className="board-empty-orbit board-empty-orbit-outer" />
                      <span className="board-empty-orbit board-empty-orbit-inner" />
                      <span className="board-empty-symbol">
                        <svg
                          width="32"
                          height="32"
                          viewBox="0 0 32 32"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M8 10C5 10 3 13 4 16C3 20 6 25 11 26C17 29 23 25 25 21C29 20 29 16 26 14C24 8 17 6 12 8C10 7 8 8 8 10Z" />
                          <path d="M17 7C17 3 21 2 26 3C25 7 21 9 17 7Z" />
                          <path d="M8 16C8 13 10 11 13 11" />
                          <path d="M11 21L11.1 21M17 23L17.1 23M21 17L21.1 17" />
                        </svg>
                      </span>
                      <span className="board-empty-satellite board-empty-satellite-one">
                        <LemonSlice />
                      </span>
                      <span className="board-empty-satellite board-empty-satellite-two">
                        <LemonSlice />
                      </span>
                      <span className="board-empty-satellite board-empty-satellite-three">
                        <LemonSlice />
                      </span>
                    </div>
                    {totalForStatus(status) ? (
                      <>
                        <p>No tasks from this status on this page.</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            configureView(
                              "statusId",
                              savedStatuses.find(
                                (option) => option.label === status,
                              )?.id ?? "__none__",
                            )
                          }
                        >
                          Show {status}
                        </Button>
                      </>
                    ) : (
                      <p>No tasks yet on this status.</p>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div className="board-table-scroll max-h-[700px] overflow-auto rounded-xl border bg-card">
          <table
            className={`w-full text-left text-sm ${fields.length ? "min-w-[700px]" : ""}`}
          >
            <caption className="sr-only">{name} fields</caption>
            <thead>
              <tr>
                {!fields.length && (
                  <th scope="col" className="border-b px-5 py-4 font-medium">
                    Task
                  </th>
                )}
                {fields.map((field) => (
                  <th
                    scope="col"
                    key={field.id}
                    className="border-b px-5 py-4 font-medium"
                  >
                    {field.name}
                  </th>
                ))}
                <th scope="col" className="border-b px-5 py-4 font-medium">
                  Task checklist
                </th>
              </tr>
            </thead>
            <VirtualTableBody
              items={tasks}
              columns={Math.max(fields.length, 1) + 1}
            >
              {(task) => (
                <tr key={task.id} data-task-id={task.id}>
                  {(fields.length
                    ? state.fields
                    : [
                        {
                          version: "",
                          id: "name",
                          key: "name",
                          name: "Task",
                          type: "TEXT",
                          options: [],
                        },
                      ]
                  ).map((field) => (
                    <td key={field.id} className="border-b px-4 py-3">
                      {field.key === "name" ? (
                        <button
                          className="text-left font-medium text-primary"
                          onClick={() => {
                            mutation.reset();
                            setSelectedTab("details");
                            setSelectedId(task.id);
                          }}
                        >
                          {task.name}
                        </button>
                      ) : field.key === "status" ? (
                        <select
                          aria-label={`Status for ${task.name}`}
                          className="task-select min-w-32"
                          disabled={!task.canEdit || busy}
                          value={task.statusId ?? ""}
                          style={optionBadgeStyle(
                            savedStatuses.find(
                              (option) => option.id === task.statusId,
                            ),
                          )}
                          onChange={(event) =>
                            patch(task, {
                              statusId: event.target.value || null,
                            })
                          }
                        >
                          <option value="">No status</option>
                          {savedStatuses.map((option) => (
                            <option value={option.id} key={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : field.key === "priority" ? (
                        <select
                          aria-label={`Priority for ${task.name}`}
                          className="task-select min-w-24"
                          disabled={!task.canEdit || busy}
                          value={task.priority}
                          style={optionBadgeStyle(
                            priorityOptions(state).find(
                              (option) => option.id === task.priority,
                            ),
                          )}
                          onChange={(event) =>
                            patch(task, { priority: event.target.value })
                          }
                        >
                          {priorityOptions(state).map(
                            ({ id: priority, label }) => (
                              <option key={priority} value={priority}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      ) : field.key === "start_date" ? (
                        task.startDate ? (
                          <span className="inline-flex items-center gap-2">
                            <CalendarDays size={14} />
                            {formatDueDate(task.startDate)}
                          </span>
                        ) : (
                          "—"
                        )
                      ) : field.key === "due_date" ? (
                        task.dueDate ? (
                          <span className="inline-flex items-center gap-2">
                            <CalendarDays size={14} />
                            {formatDueDate(task.dueDate)}
                          </span>
                        ) : (
                          "—"
                        )
                      ) : field.key === "description" ? (
                        task.description || "—"
                      ) : field.key === "assignees" ? (
                        <AssigneeAvatars
                          ids={task.assigneeIds}
                          people={state.people}
                        />
                      ) : field.type === "TAGS" ? (
                        <div className="task-card-tags m-0">
                          {selectedChoices(task, field.id).map((id) => (
                            <span
                              key={id}
                              style={optionBadgeStyle(
                                field.options.find(
                                  (option) => option.id === id,
                                ),
                              )}
                            >
                              {field.options.find((option) => option.id === id)
                                ?.label ?? id}
                            </span>
                          ))}
                        </div>
                      ) : (
                        formatCustom(task, field)
                      )}
                    </td>
                  ))}
                  <td className="border-b px-4 py-3">
                    {task.checklist.length ? (
                      <button
                        type="button"
                        className="flex items-center gap-2 text-left text-primary"
                        aria-label={`Open checklist for ${task.name}`}
                        onClick={() => {
                          mutation.reset();
                          setSelectedTab("details");
                          setSelectedId(task.id);
                        }}
                      >
                        <ListChecks size={15} />
                        <span>
                          {task.checklist.filter((item) => item.done).length}/
                          {task.checklist.length}
                        </span>
                        <span className="max-w-48 truncate text-xs text-muted-foreground">
                          {task.checklist.map((item) => item.text).join(", ")}
                        </span>
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              )}
            </VirtualTableBody>
            {!tasks.length && (
              <tbody>
                <tr>
                  <td
                    colSpan={Math.max(1, fields.length) + 1}
                    className="p-12 text-center"
                  >
                    <Columns3 size={26} className="mx-auto mb-4 text-primary" />
                    <p className="font-medium">
                      A clean start for {group.toLowerCase()}.
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      No sample records were created during installation.
                    </p>
                  </td>
                </tr>
              </tbody>
            )}
          </table>
        </div>
      )}
      {state.pagination && view !== "calendar" && view !== "timeline" && (
        <nav
          aria-label="Task pages"
          className="my-4 flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <span role="status">
            {query.isFetching ? "Updating tasks... " : ""}
            {total
              ? `${(state.pagination.page - 1) * 100 + 1}-${Math.min(state.pagination.page * 100, total)} of ${total.toLocaleString()} tasks`
              : "No matching tasks"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={query.isFetching || state.pagination.page <= 1}
              onClick={() =>
                setPageRequest({ configKey, page: state.pagination!.page - 1 })
              }
            >
              Previous tasks
            </Button>
            <label>
              Page{" "}
              <input
                aria-label="Task page"
                type="number"
                className="w-16 rounded border bg-background px-2 py-1"
                min={1}
                max={state.pagination.pageCount}
                value={state.pagination.page}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (
                    Number.isInteger(value) &&
                    value >= 1 &&
                    value <= state.pagination!.pageCount
                  )
                    setPageRequest({ configKey, page: value });
                }}
              />{" "}
              of {state.pagination.pageCount}
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={
                query.isFetching ||
                state.pagination.page >= state.pagination.pageCount
              }
              onClick={() =>
                setPageRequest({ configKey, page: state.pagination!.page + 1 })
              }
            >
              Next tasks
            </Button>
          </div>
        </nav>
      )}
      <section className="board-overview" aria-label="Board structure overview">
        <h2>
          <Layers3 size={16} />
          Project overview
        </h2>
        <div className="board-overview-grid">
          <div>
            <span>Saved fields</span>
            <strong>{fields.length}</strong>
            <p>
              {fields.map((field) => field.name).join(" · ") ||
                "No fields configured"}
            </p>
          </div>
          <div>
            <span>Status lanes</span>
            <strong>{statuses.length}</strong>
            <p>{statuses.join(" · ") || "No statuses configured"}</p>
          </div>
          <div>
            <span>Groups</span>
            <strong>{state.groups.length}</strong>
            <p>
              {state.groups.map((item) => item.name).join(" · ") ||
                "No groups configured"}
            </p>
          </div>
        </div>
      </section>
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent className="board-details-panel">
          <span className="board-detail-eyebrow">Saved board</span>
          <SheetTitle>{name}</SheetTitle>
          <SheetDescription>
            {info?.workspace ?? "Your workspace"}
          </SheetDescription>
          <div className="board-details-meta">
            <div>
              <UserRound size={16} />
              <span>
                Created by<b>{info?.creator ?? "Your team"}</b>
              </span>
            </div>
            {info && (
              <div>
                <CalendarDays size={16} />
                <span>
                  Created
                  <b>
                    {new Date(info.createdAt).toLocaleDateString("en-GB", {
                      timeZone: "UTC",
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </b>
                </span>
              </div>
            )}
          </div>
          <section>
            <h3>
              <ListChecks size={16} />
              Board structure
            </h3>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              Configure fields and status order here. Open a task to edit its
              values.
            </p>
            <dl className="board-field-list">
              {fields.map((field) => (
                <div key={field.id}>
                  <dt>{field.name}</dt>
                  <dd>
                    {field.type?.toLowerCase().replaceAll("_", " ") ?? "Field"}
                  </dd>
                </div>
              ))}
              {!fields.length && (
                <p className="text-sm text-muted-foreground">
                  No fields configured.
                </p>
              )}
            </dl>
          </section>
          <section>
            <h3>
              <Layers3 size={16} />
              Status lanes
            </h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {statuses.map((status) => (
                <span key={status} className="board-detail-tag">
                  {status}
                </span>
              ))}
              {!statuses.length && (
                <p className="text-sm text-muted-foreground">
                  No statuses configured.
                </p>
              )}
            </div>
          </section>
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          {state.canManage && (
            <BoardManagement state={state} pending={busy} onAction={act} />
          )}
          <div className="mt-auto border-t pt-5">
            <Button className="w-full" onClick={() => setDetailsOpen(false)}>
              Back to board
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet
        open={creating || Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setSelectedId(null);
            clearTaskLink();
            mutation.reset();
          }
        }}
      >
        <SheetContent
          ref={taskSheetRef}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            taskSheetRef.current?.focus();
          }}
          className="board-details-panel task-sheet-panel task-panel outline-none"
        >
          <PauseLeaf />
          <span className="pause-clip" aria-hidden="true">
            <PauseSlice />
          </span>
          <TaskEditor
            key={selected?.id ?? `create-${createDueDate ?? ""}`}
            defaultDueDate={selected ? undefined : createDueDate}
            state={state}
            task={selected}
            initialTab={selectedTab}
            syncInterval={live.syncInterval}
            onNotice={notify}
            onTransferNotice={transferNotice}
            uploads={uploads}
            pending={busy}
            error={mutation.error?.message}
            onSubmit={(input) =>
              act(selected ? "update" : "create-task", input, selected)
            }
            onAction={act}
          />
        </SheetContent>
      </Sheet>
    </section>
  );
}

function LemonSlice() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="4" />
      <path d="M8 4V12M4 8H12M5.2 5.2L10.8 10.8M5.2 10.8L10.8 5.2" />
    </svg>
  );
}
