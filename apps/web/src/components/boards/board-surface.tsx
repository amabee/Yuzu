"use client";
import { PauseSheetDecor } from "@/components/pause/pause-sheet";
import { ExportCsv } from "./export-csv";
import { ImportCsv } from "./import-csv";
import { matchesBoardView } from "@/lib/board-view";
import { mergeBoardState } from "@/lib/board-cache";
import { VirtualTableBody } from "./virtual-task-list";
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
  type BoardState,
  type BoardTask,
  type BoardField,
  recordOf,
  visibleFields,
} from "@/lib/board-contract";
import { OperationToast, type BoardNotice } from "./operation-toast";
import { builtinName, countOf, formatNumber, lower } from "@/lib/record-types";
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
} from "lucide-react";
import { BoardCalendarView } from "./board-calendar";
import { BoardKanban, type KanbanPlacement } from "./board-kanban";
import { BoardPulse } from "./board-pulse";
import { BoardAutomations } from "./board-automations";
import { PauseSlice } from "@/components/pause/decor";
import { PauseAlert } from "@/components/pause/pause-alert";
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
  const record = recordOf(state);
  const noun = lower(record.singular);
  const nouns = lower(record.plural);
  const checklistOn = record.builtins.checklist.on;
  const fields = visibleFields(state);
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
        "create-task": `${record.singular} created`,
        update: `${record.singular} updated`,
        archive: `${record.singular} archived`,
        restore: `${record.singular} restored`,
        editor: `${record.singular} permissions updated`,
        "record-settings": "Board records updated",
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
      placement,
    }: {
      task: BoardTask;
      changes: Partial<
        Pick<BoardTask, "statusId" | "priority" | "startDate" | "dueDate">
      >;
      placement?: KanbanPlacement;
    }) => {
      const result = Object.keys(changes).length
        ? taskMutationResultSchema.parse(
            (
              await saveTaskUpdate(
                state.boardId,
                { taskId: task.id, revision: task.revision, changes },
                task,
              )
            ).data,
          )
        : ({
            outcome: "APPLIED",
            taskId: task.id,
            revision: task.revision,
          } as const);
      if (placement && result.outcome === "APPLIED")
        await apiRequest("/api/v1/boards/reorder", {
          method: "POST",
          json: { taskId: task.id, ...placement },
        });
      return result;
    },
    onMutate: async ({ task, changes, placement }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<BoardState>(queryKey);
      if (!needsApproval(state.approvalPolicy, "UPDATE", changes, state.fields))
        queryClient.setQueryData<BoardState>(queryKey, (current) => {
          if (!current) return current;
          const position = placement
            ? placeBetween(current.tasks, placement)
            : undefined;
          return {
            ...current,
            tasks: current.tasks.map((item) =>
              item.id === task.id
                ? {
                    ...item,
                    ...changes,
                    ...(position !== undefined ? { position } : {}),
                  }
                : item,
            ),
          };
        });
      return { previous };
    },
    onSuccess: (result, variables, context) => {
      if (result.outcome === "PENDING_APPROVAL") {
        if (context?.previous)
          queryClient.setQueryData(queryKey, context.previous);
        notify("Changes sent for approval", "info");
        return;
      }
      notify(
        Object.keys(variables.changes).length ? "Task updated" : "Task moved",
        "success",
      );
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
  const manualOrder = viewConfig.sort === "created";
  /** Saves a drag: status first (it may need approval), then the new spot. */
  const moveTask = ({
    task,
    lane,
    statusChanged,
    placement,
  }: {
    task: BoardTask;
    lane: { statusId: string | null };
    statusChanged: boolean;
    placement: KanbanPlacement | null;
  }) => {
    if (busy) return false;
    const changes = statusChanged ? { statusId: lane.statusId } : {};
    const waits =
      statusChanged &&
      needsApproval(state.approvalPolicy, "UPDATE", changes, state.fields);
    inlineMutation.mutate({
      task,
      changes,
      placement: waits ? undefined : (placement ?? undefined),
    });
    return !waits;
  };
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
    if (field.type === "RELATION")
      return (
        (Array.isArray(value) ? value : [])
          .map((id) => state.linked?.[id]?.name ?? "Private item")
          .join(", ") || "—"
      );
    if (
      (field.type === "NUMBER" || field.type === "ROLLUP") &&
      typeof value === "number"
    )
      return formatNumber(value, field.number, state.currency);
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
  const [createStatusId, setCreateStatusId] = useState<string | undefined>();
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
      <BoardPulse
        state={state}
        tone={(statusId, index) =>
          savedStatuses.find((option) => option.id === statusId)?.color ??
          laneTone(statusId, index)
        }
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
        <PauseAlert
          intent="warning"
          className="board-approval-alert"
          action={<Link href="/approvals">Review requests</Link>}
        >
          {state.pendingApprovalCount ?? state.pendingApprovals.length} pending
          approval{" "}
          {(state.pendingApprovalCount ?? state.pendingApprovals.length) === 1
            ? "request"
            : "requests"}
          . Current task values stay unchanged.
        </PauseAlert>
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
          <span className="text-xs text-muted-foreground">
            {countOf(record, total)}
          </span>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              mutation.reset();
              setCreateDueDate(undefined);
              setCreateStatusId(undefined);
              setCreating(true);
            }}
          >
            Add {noun}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={archived}
            onClick={() => setArchived(!archived)}
          >
            {archived ? `Active ${nouns}` : "Archived"}
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
          <BoardAutomations state={state} />
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
          record={record}
        />
      )}
      {view === "board" && !record.builtins.status.on ? (
        <p role="status" className="audit-empty">
          The Kanban view groups {nouns} by {builtinName(record, "status")},
          which is turned off on this board. Use the table, or turn it on in
          Board details → Records on this board.
        </p>
      ) : (view === "calendar" && !record.builtins.dueDate.on) ||
        (view === "timeline" &&
          !record.builtins.dueDate.on &&
          !record.builtins.startDate.on) ? (
        <p role="status" className="audit-empty">
          {view === "calendar" ? "The calendar" : "The timeline"} places {nouns}{" "}
          by their dates, which are turned off on this board. Turn on{" "}
          {builtinName(record, "dueDate")} in Board details → Records on this
          board to use it.
        </p>
      ) : view === "timeline" ? (
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
            setSelectedId(taskId);
          }}
          onMove={(task, dueDate) => patch(task, { dueDate })}
          onCreate={(dueDate) => {
            mutation.reset();
            setCreateDueDate(dueDate);
            setCreating(true);
          }}
        />
      ) : view === "board" ? (
        <BoardKanban
          lanes={visibleStatuses.map((status, index) => {
            const option = savedStatuses.find((item) => item.label === status);
            const laneTasks = tasks.filter(
              (task) => statusLabel(task) === status,
            );
            return {
              key: status,
              label: status,
              statusId: option?.id ?? null,
              icon: option?.icon,
              tone: option?.color ?? laneTone(option?.id ?? null, index),
              count: totalForStatus(status),
              tasks: manualOrder
                ? [...laneTasks].sort(
                    (a, b) => (a.position ?? 0) - (b.position ?? 0),
                  )
                : laneTasks,
            };
          })}
          state={state}
          busy={busy || archived}
          manualOrder={manualOrder}
          canAdd={!archived}
          formatCustom={formatCustom}
          onOpen={(task) => {
            mutation.reset();
            setSelectedId(task.id);
          }}
          onArchive={(task) =>
            act("archive", { taskId: task.id, revision: task.revision })
          }
          onAdd={(lane) => {
            mutation.reset();
            setCreateDueDate(undefined);
            setCreateStatusId(lane.statusId ?? "");
            setCreating(true);
          }}
          onShowStatus={(lane) =>
            configureView("statusId", lane.statusId ?? "__none__")
          }
          onMove={moveTask}
        />
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
                    {record.singular}
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
                {checklistOn && (
                  <th scope="col" className="border-b px-5 py-4 font-medium">
                    {record.singular}{" "}
                    {builtinName(record, "checklist").toLowerCase()}
                  </th>
                )}
              </tr>
            </thead>
            <VirtualTableBody
              items={tasks}
              columns={Math.max(fields.length, 1) + (checklistOn ? 1 : 0)}
            >
              {(task) => (
                <tr key={task.id} data-task-id={task.id}>
                  {(fields.length
                    ? fields
                    : [
                        {
                          version: "",
                          id: "name",
                          key: "name",
                          name: record.singular,
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
                  {checklistOn && (
                    <td className="border-b px-4 py-3">
                      {task.checklist.length ? (
                        <button
                          type="button"
                          className="flex items-center gap-2 text-left text-primary"
                          aria-label={`Open checklist for ${task.name}`}
                          onClick={() => {
                            mutation.reset();
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
                  )}
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
          aria-label={`${record.singular} pages`}
          className="my-4 flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <span role="status">
            {query.isFetching ? `Updating ${nouns}... ` : ""}
            {total
              ? `${(state.pagination.page - 1) * 100 + 1}-${Math.min(state.pagination.page * 100, total)} of ${countOf(record, total)}`
              : `No matching ${nouns}`}
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
              Previous {nouns}
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
              Next {nouns}
            </Button>
          </div>
        </nav>
      )}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent className="pause-sheet board-details-sheet">
          <PauseSheetDecor />
          <div className="pause-sheet-body board-details-body">
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
                      {field.type?.toLowerCase().replaceAll("_", " ") ??
                        "Field"}
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
            {record.builtins.status.on && (
              <section>
                <h3>
                  <Layers3 size={16} />
                  {builtinName(record, "status")} lanes
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
            )}
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
          <span className="task-panel-leaf" aria-hidden="true" />
          <span className="pause-clip" aria-hidden="true">
            <PauseSlice />
          </span>
          <TaskEditor
            key={
              selected?.id ??
              `create-${createDueDate ?? ""}-${createStatusId ?? ""}`
            }
            defaultDueDate={selected ? undefined : createDueDate}
            defaultStatusId={selected ? undefined : createStatusId}
            state={state}
            task={selected}
            boardName={name}
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

/** Mirrors the server: halfway between neighbours, or a step past one. */
function placeBetween(tasks: BoardTask[], placement: KanbanPlacement) {
  const after = tasks.find((task) => task.id === placement.afterId)?.position;
  const before = tasks.find((task) => task.id === placement.beforeId)?.position;
  if (after !== undefined && before !== undefined) return (after + before) / 2;
  if (after !== undefined) return after + 1024;
  if (before !== undefined) return before - 1024;
  return undefined;
}

/** Status colors when a status has none of its own: the defaults read as
 *  states, the rest cycle through theme-friendly hues. */
function laneTone(statusId: string | null, index: number) {
  const defaults: Record<string, string> = {
    todo: "var(--muted-foreground)",
    in_progress: "var(--intent-info)",
    done: "var(--intent-success)",
  };
  const cycle = [
    "var(--primary)",
    "var(--intent-warning)",
    "var(--intent-info)",
    "var(--intent-success)",
  ];
  return (
    (statusId && defaults[statusId]) ??
    (statusId ? cycle[index % cycle.length]! : "var(--muted-foreground)")
  );
}
