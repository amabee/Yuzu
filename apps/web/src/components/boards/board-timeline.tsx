"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import { addDays, daysBetween, parseISODate } from "@/lib/calendar-contract";
import {
  adjustSpan,
  dayWidth,
  shiftWindow,
  taskSpan,
  timelineRows,
  timelineWindow,
  type BoardTimeline,
  type TimelineGroupBy,
  type TimelineZoom,
} from "@/lib/timeline-contract";
import type { ViewConfig } from "@/lib/saved-view-contract";
import type { BoardOption, BoardTask } from "@/lib/board-contract";
import { COMPLETED_STATUS_ID } from "@/lib/dashboard-contract";

type Span = { start: string; end: string };
type Dates = { startDate: string | null; dueDate: string | null };

const format = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(
    parseISODate(date),
  );
/** Last visible day: 5 weeks, or 6 whole months from the window's start. */
function windowEnd(from: string, zoom: TimelineZoom) {
  if (zoom === "weeks") return addDays(from, 34);
  const end = parseISODate(`${from.slice(0, 7)}-01`);
  end.setUTCMonth(end.getUTCMonth() + 6);
  return addDays(end.toISOString().slice(0, 10), -1);
}
const spanLabel = (span: Span) =>
  span.start === span.end
    ? format(span.start, { day: "numeric", month: "long" })
    : `${format(span.start, { day: "numeric", month: "long" })} to ${format(span.end, { day: "numeric", month: "long" })}`;

export function BoardTimelineView({
  boardKey,
  boardId,
  config,
  zoom,
  groupBy,
  onSettings,
  from,
  onWindowChange,
  today,
  weekStartsOn,
  statuses,
  groups,
  people,
  pending,
  onOpen,
  onChange,
}: {
  boardKey: unknown[];
  boardId: string;
  config: ViewConfig;
  zoom: TimelineZoom;
  groupBy: TimelineGroupBy;
  onSettings: (settings: {
    zoom: TimelineZoom;
    groupBy: TimelineGroupBy;
  }) => void;
  /** First visible day of the window. */
  from: string;
  onWindowChange: (from: string) => void;
  today: string;
  weekStartsOn: 0 | 1;
  statuses: BoardOption[];
  groups: { id: string; name: string }[];
  people: { id: string; name: string }[];
  pending: boolean;
  onOpen: (taskId: string) => void;
  onChange: (task: BoardTask, dates: Dates) => void;
}) {
  const width = dayWidth[zoom];
  const to = windowEnd(from, zoom);
  const days = Array.from({ length: daysBetween(from, to) + 1 }, (_, index) =>
    addDays(from, index),
  );
  const query = useQuery({
    queryKey: [...boardKey, "timeline", config, from, to],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        boardId,
        query: JSON.stringify({ config, from, to }),
      });
      return (
        await apiRequest<BoardTimeline>(`/api/v1/boards/timeline?${params}`, {
          signal,
          cache: "no-store",
        })
      ).data;
    },
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  // Edits show at once; the next fetch confirms or reverts them.
  const [changed, setChanged] = useState<Record<string, Dates>>({});
  const [settledAt, setSettledAt] = useState(query.dataUpdatedAt);
  if (query.dataUpdatedAt !== settledAt) {
    setSettledAt(query.dataUpdatedAt);
    if (!pending) setChanged({});
  }
  const [preview, setPreview] = useState<{ id: string; span: Span } | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");
  const datesOf = (task: BoardTask): Dates => changed[task.id] ?? task;
  const spanOf = (task: BoardTask) =>
    preview?.id === task.id ? preview.span : taskSpan(datesOf(task));
  const commit = (task: BoardTask, span: Span) => {
    // The board drops edits made while another save is running.
    if (pending) return;
    const current = taskSpan(datesOf(task));
    if (current && current.start === span.start && current.end === span.end)
      return;
    const dates = { startDate: span.start, dueDate: span.end };
    setChanged((all) => ({ ...all, [task.id]: dates }));
    setAnnouncement(`${task.name}: ${spanLabel(span)}`);
    onChange(task, dates);
  };

  // Pointer drags snap to whole days.
  const drag = useRef<{
    task: BoardTask;
    edit: "move" | "start" | "end";
    x: number;
    span: Span;
    moved: boolean;
  } | null>(null);
  const startDrag = (
    event: React.PointerEvent,
    task: BoardTask,
    edit: "move" | "start" | "end",
  ) => {
    const span = taskSpan(datesOf(task));
    if (!span || event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { task, edit, x: event.clientX, span, moved: false };
  };
  const moveDrag = (event: React.PointerEvent) => {
    const active = drag.current;
    if (!active) return;
    const offset = Math.round((event.clientX - active.x) / width);
    if (offset !== 0) active.moved = true;
    if (active.moved && active.task.canEdit && !pending)
      setPreview({
        id: active.task.id,
        span: adjustSpan(active.span, active.edit, offset),
      });
  };
  const endDrag = (event: React.PointerEvent) => {
    const active = drag.current;
    drag.current = null;
    if (!active) return;
    if (!active.moved) {
      if (active.edit === "move") onOpen(active.task.id);
      setPreview(null);
      return;
    }
    const offset = Math.round((event.clientX - active.x) / width);
    setPreview(null);
    if (active.task.canEdit)
      commit(active.task, adjustSpan(active.span, active.edit, offset));
  };

  // Keyboard edits preview immediately and save once the person pauses.
  const keyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(keyTimer.current), []);
  const onBarKey = (event: React.KeyboardEvent, task: BoardTask) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(task.id);
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step || !task.canEdit || pending) return;
    event.preventDefault();
    const base = spanOf(task);
    if (!base) return;
    const edit = event.shiftKey ? (event.altKey ? "start" : "end") : "move";
    const span = adjustSpan(base, edit, step);
    setPreview({ id: task.id, span });
    setAnnouncement(`${task.name}: ${spanLabel(span)}`);
    clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => {
      setPreview(null);
      commit(task, span);
    }, 700);
  };

  // Unscheduled tasks are dropped onto the body; the column picks the day.
  const body = useRef<HTMLDivElement>(null);
  const scheduleDrag = useRef<BoardTask | null>(null);
  const droppedChip = useRef(false);
  const dayAt = (clientX: number) => {
    const rect = body.current
      ?.querySelector(".timeline-track")
      ?.getBoundingClientRect();
    if (!rect) return null;
    const index = Math.floor((clientX - rect.left) / width);
    return index >= 0 && index < days.length ? days[index] : null;
  };

  const tasks = data?.tasks ?? [];
  const scheduled = tasks.filter((task) => taskSpan(datesOf(task)));
  const unscheduled = [
    ...(data?.unscheduled ?? []).filter((task) => !taskSpan(datesOf(task))),
    ...tasks.filter((task) => !taskSpan(datesOf(task))),
  ];
  const rows = timelineRows(scheduled, groupBy, { groups, statuses, people });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const status = (task: BoardTask) =>
    statuses.find((option) => option.id === task.statusId);
  const todayIndex = daysBetween(from, today);
  const trackWidth = days.length * width;
  // Weekend shading helps at day scale; at Months zoom it is only noise.
  const weekend = (date: string) => {
    if (zoom !== "weeks") return false;
    const day = parseISODate(date).getUTCDay();
    return day === 0 || day === 6;
  };
  // Bring today into view when the window or zoom changes, so narrow
  // screens don't open on the empty start of the window.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroller.current;
    if (!element || todayIndex < 0 || todayIndex >= days.length) return;
    // Put today a third of the way across the visible track.
    const label =
      element.querySelector<HTMLElement>(".timeline-corner")?.offsetWidth ?? 0;
    const visible = element.clientWidth - label;
    element.scrollLeft = Math.max(0, todayIndex * width - visible / 3);
  }, [from, zoom, width, todayIndex, days.length]);

  const bar = (task: BoardTask) => {
    const span = spanOf(task);
    if (!span) return null;
    const option = status(task);
    const start = Math.max(0, daysBetween(from, span.start));
    const end = Math.min(days.length - 1, daysBetween(from, span.end));
    if (end < 0 || start > days.length - 1) return null;
    const marker =
      !preview || preview.id !== task.id
        ? (taskSpan(datesOf(task))?.marker ?? false)
        : false;
    const label = `${task.name}${task.parentName ? `, subitem of ${task.parentName}` : ""}, ${spanLabel(span)}${option ? `, ${option.label}` : ""}`;
    const editable = task.canEdit && !pending;
    const style = {
      left: start * width,
      width: Math.max(width, (end - start + 1) * width),
      "--bar-color": option?.color ?? "var(--primary)",
    } as React.CSSProperties;
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label}${task.canEdit ? ". Arrow keys move it; Shift changes the due date, Alt+Shift the start date" : ""}`}
        className="timeline-bar"
        data-marker={marker || undefined}
        data-done={task.statusId === COMPLETED_STATUS_ID || undefined}
        data-dragging={preview?.id === task.id || undefined}
        data-clipped-start={daysBetween(from, span.start) < 0 || undefined}
        data-clipped-end={
          daysBetween(from, span.end) > days.length - 1 || undefined
        }
        style={style}
        onPointerDown={(event) => startDrag(event, task, "move")}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => {
          drag.current = null;
          setPreview(null);
        }}
        onKeyDown={(event) => onBarKey(event, task)}
      >
        {editable && !marker && (
          <span
            className="timeline-handle"
            data-edge="start"
            aria-hidden="true"
            onPointerDown={(event) => startDrag(event, task, "start")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
          />
        )}
        <span className="timeline-bar-name">
          {task.name}
          {task.parentName ? (
            <small className="ml-1 text-muted-foreground">
              Subitem of {task.parentName}
            </small>
          ) : null}
        </span>
        {editable && !marker && (
          <span
            className="timeline-handle"
            data-edge="end"
            aria-hidden="true"
            onPointerDown={(event) => startDrag(event, task, "end")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
          />
        )}
      </div>
    );
  };

  const range =
    zoom === "weeks"
      ? `${format(from, { day: "numeric", month: "short" })} – ${format(to, { day: "numeric", month: "short", year: "numeric" })}`
      : `${format(from, { month: "short", year: "numeric" })} – ${format(to, { month: "short", year: "numeric" })}`;
  return (
    <div className="board-timeline">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="timeline-toolbar">
        <div className="timeline-segment" role="group" aria-label="Zoom">
          {(["weeks", "months"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={zoom === value}
              onClick={() => onSettings({ zoom: value, groupBy })}
            >
              {value === "weeks" ? "Weeks" : "Months"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          Rows
          <select
            aria-label="Timeline rows"
            className="task-select project-role-select"
            value={groupBy}
            onChange={(event) =>
              onSettings({
                zoom,
                groupBy: event.target.value as TimelineGroupBy,
              })
            }
          >
            <option value="group">Group</option>
            <option value="status">Status</option>
            <option value="assignee">Assignee</option>
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 text-sm text-muted-foreground">{range}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Earlier"
            onClick={() => onWindowChange(shiftWindow(from, zoom, -1))}
          >
            <ChevronLeft size={18} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onWindowChange(timelineWindow(today, zoom, weekStartsOn).from)
            }
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Later"
            onClick={() => onWindowChange(shiftWindow(from, zoom, 1))}
          >
            <ChevronRight size={18} />
          </Button>
        </div>
      </div>
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the timeline. {query.error.message}
        </p>
      )}
      {(data?.total ?? 0) > tasks.length && (
        <p className="text-sm text-muted-foreground">
          Showing {tasks.length} of {data!.total} tasks in this window. Narrow
          the filters to see the rest.
        </p>
      )}
      <div
        ref={scroller}
        className="timeline-scroll"
        style={{ "--day": `${width}px` } as React.CSSProperties}
        aria-busy={query.isFetching}
      >
        <div
          className="timeline"
          ref={body}
          style={{
            gridTemplateColumns: `var(--timeline-label) ${trackWidth}px`,
          }}
        >
          <div className="timeline-corner">Task</div>
          <div className="timeline-axis timeline-track" aria-hidden="true">
            {days.map((date, index) => {
              const label =
                zoom === "weeks"
                  ? index === 0 ||
                    parseISODate(date).getUTCDay() === weekStartsOn
                    ? format(date, { day: "numeric", month: "short" })
                    : null
                  : date.endsWith("-01") || index === 0
                    ? format(date, { month: "short", year: "numeric" })
                    : null;
              return (
                <span
                  key={date}
                  className="timeline-day"
                  data-weekend={weekend(date) || undefined}
                  data-today={date === today || undefined}
                  style={{ left: index * width, width }}
                >
                  {label && <b>{label}</b>}
                  {zoom === "weeks" && (
                    <small>{format(date, { weekday: "narrow" })}</small>
                  )}
                </span>
              );
            })}
          </div>
          {rows.length === 0 && (
            <p className="timeline-empty">
              No scheduled tasks in this window. Give tasks a start or due date,
              or move to another period.
            </p>
          )}
          {rows.map((row) => {
            const closed = collapsed.has(row.id);
            return (
              <section
                key={row.id}
                className="timeline-section"
                aria-label={`${row.label}, ${row.tasks.length} ${row.tasks.length === 1 ? "task" : "tasks"}`}
              >
                <button
                  type="button"
                  className="timeline-section-head"
                  aria-expanded={!closed}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                >
                  <ChevronRight size={14} className="timeline-caret" />
                  {row.label}
                  <span className="text-muted-foreground">
                    {row.tasks.length}
                  </span>
                </button>
                <div className="timeline-section-fill" />
                {!closed &&
                  row.tasks.map((task) => (
                    <div className="timeline-row" key={`${row.id}:${task.id}`}>
                      <button
                        type="button"
                        className="timeline-label"
                        tabIndex={-1}
                        onClick={() => onOpen(task.id)}
                      >
                        {task.name}
                        {task.parentName ? (
                          <small className="block text-muted-foreground">
                            Subitem of {task.parentName}
                          </small>
                        ) : null}
                      </button>
                      <div className="timeline-track">
                        {days.map((date, index) =>
                          weekend(date) ? (
                            <span
                              key={date}
                              className="timeline-weekend"
                              style={{ left: index * width, width }}
                            />
                          ) : null,
                        )}
                        {todayIndex >= 0 && todayIndex < days.length && (
                          <span
                            className="timeline-today"
                            style={{ left: todayIndex * width + width / 2 }}
                          />
                        )}
                        {bar(task)}
                      </div>
                    </div>
                  ))}
              </section>
            );
          })}
        </div>
      </div>
      <section
        aria-labelledby="timeline-unscheduled"
        className="timeline-unscheduled"
      >
        <h3 id="timeline-unscheduled">
          Not scheduled
          <span className="text-muted-foreground">
            {" "}
            {data?.unscheduledTotal ?? 0}
          </span>
        </h3>
        {unscheduled.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Every matching task has a date.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map((task) => (
              <button
                key={task.id}
                type="button"
                className="calendar-chip timeline-unscheduled-chip"
                aria-label={`${task.name}${task.parentName ? `, subitem of ${task.parentName}` : ""}. Opens the task to set dates; drag onto the timeline to schedule it`}
                onClick={() => {
                  // A drop onto the timeline also ends in a click; skip it.
                  if (droppedChip.current) droppedChip.current = false;
                  else onOpen(task.id);
                }}
                onPointerDown={(event) => {
                  if (!task.canEdit || pending || event.button !== 0) return;
                  // Capture so the release reports where it happened.
                  event.currentTarget.setPointerCapture(event.pointerId);
                  scheduleDrag.current = task;
                }}
                onPointerUp={(event) => {
                  const dragged = scheduleDrag.current;
                  scheduleDrag.current = null;
                  const above =
                    event.clientY <
                    event.currentTarget.getBoundingClientRect().top;
                  const date = dragged && above ? dayAt(event.clientX) : null;
                  if (dragged && date) {
                    droppedChip.current = true;
                    commit(dragged, { start: date, end: date });
                  }
                }}
              >
                <span
                  className="calendar-chip-dot"
                  style={
                    status(task)?.color
                      ? { backgroundColor: status(task)!.color }
                      : undefined
                  }
                />
                <span className="calendar-chip-name">
                  {task.name}
                  {task.parentName ? (
                    <small className="block text-muted-foreground">
                      Subitem of {task.parentName}
                    </small>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
        {(data?.unscheduledTotal ?? 0) > (data?.unscheduled.length ?? 0) && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing {data!.unscheduled.length} of {data!.unscheduledTotal}. Use
            the table to see the rest.
          </p>
        )}
      </section>
    </div>
  );
}
