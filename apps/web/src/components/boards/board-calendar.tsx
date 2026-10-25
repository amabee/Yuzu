"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover } from "radix-ui";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import {
  addDays,
  daySlots,
  monthGrid,
  parseISODate,
  shiftMonth,
  type BoardCalendar,
} from "@/lib/calendar-contract";
import type { ViewConfig } from "@/lib/saved-view-contract";
import type { BoardOption, BoardTask } from "@/lib/board-contract";
import { COMPLETED_STATUS_ID } from "@/lib/dashboard-contract";

type Person = { id: string; name: string };

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(parseISODate(date));

export function BoardCalendarView({
  boardKey,
  boardId,
  config,
  month: shown,
  today,
  weekStartsOn,
  onMonthChange,
  statuses,
  people,
  pending,
  onOpen,
  onMove,
  onCreate,
}: {
  boardKey: unknown[];
  boardId: string;
  config: ViewConfig;
  /** The visible month, "YYYY-MM". */
  month: string;
  /** Today in the installation's timezone. */
  today: string;
  weekStartsOn: 0 | 1;
  onMonthChange: (month: string) => void;
  statuses: BoardOption[];
  people: Person[];
  pending: boolean;
  onOpen: (taskId: string) => void;
  onMove: (task: BoardTask, dueDate: string | null) => void;
  onCreate: (dueDate: string) => void;
}) {
  const grid = monthGrid(shown, weekStartsOn);
  const query = useQuery({
    queryKey: [...boardKey, "calendar", config, grid.from, grid.to],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        boardId,
        query: JSON.stringify({ config, from: grid.from, to: grid.to }),
      });
      return (
        await apiRequest<BoardCalendar>(`/api/v1/boards/calendar?${params}`, {
          signal,
          cache: "no-store",
        })
      ).data;
    },
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  // Dates changed here show at once; the next fetch confirms or reverts them.
  const [moved, setMoved] = useState<Record<string, string | null>>({});
  const [carrying, setCarrying] = useState<{
    task: BoardTask;
    date: string | null;
  } | null>(null);
  const [dropDate, setDropDate] = useState<string | null | undefined>();
  const [announcement, setAnnouncement] = useState("");
  const [openDay, setOpenDay] = useState<string | null>(null);
  // Focus goes back to whichever button opened a day's list.
  const opener = useRef<HTMLButtonElement | null>(null);
  const dueOf = (task: BoardTask) =>
    task.id in moved ? moved[task.id] : task.dueDate;
  const allTasks = [...(data?.tasks ?? []), ...(data?.undated ?? [])];
  const byDay = new Map<string, BoardTask[]>();
  for (const task of allTasks) {
    const due = dueOf(task);
    if (due) byDay.set(due, [...(byDay.get(due) ?? []), task]);
  }
  const undated = allTasks.filter((task) => !dueOf(task));
  // Server counts include tasks past the response limit; adjust for local moves.
  const dayTotal = (date: string) => {
    const loaded = byDay.get(date)?.length ?? 0;
    const original = (data?.tasks ?? []).filter(
      (task) => task.dueDate === date,
    ).length;
    return Math.max(loaded, (data?.dayCounts[date] ?? 0) - original + loaded);
  };
  const move = (task: BoardTask, date: string | null) => {
    // The board drops edits made while another save is running.
    if (pending || dueOf(task) === date) return;
    setMoved((current) => ({ ...current, [task.id]: date }));
    setAnnouncement(
      date
        ? `Moved ${task.name} to ${dayLabel(date)}`
        : `Removed the due date from ${task.name}`,
    );
    onMove(task, date);
  };
  // Drop local overrides once fresh data reflects (or rejects) them.
  const [settledAt, setSettledAt] = useState(query.dataUpdatedAt);
  if (query.dataUpdatedAt !== settledAt) {
    setSettledAt(query.dataUpdatedAt);
    if (!pending) setMoved({});
  }
  const status = (task: BoardTask) =>
    statuses.find((option) => option.id === task.statusId);
  const initials = (task: BoardTask) =>
    task.assigneeIds
      .map((id) => people.find((person) => person.id === id)?.name.charAt(0))
      .filter(Boolean)
      .slice(0, 2)
      .join("");
  const chip = (task: BoardTask) => {
    const option = status(task);
    const isCarried = carrying?.task.id === task.id;
    // A focusable div rather than <button>: Chromium won't start a native
    // drag from a button. Keyboard behavior is handled below.
    return (
      <div
        key={task.id}
        role="button"
        tabIndex={0}
        className="calendar-chip"
        data-done={task.statusId === COMPLETED_STATUS_ID || undefined}
        data-carried={isCarried || undefined}
        draggable={task.canEdit && !pending}
        aria-label={`${task.name}${task.parentName ? `, subitem of ${task.parentName}` : ""}${option ? `, ${option.label}` : ""}${task.canEdit ? ". Press Space to move" : ""}`}
        aria-pressed={isCarried || undefined}
        onClick={() => !carrying && onOpen(task.id)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(dragMime, task.id);
          event.dataTransfer.setData("text/plain", task.name);
        }}
        onDragEnd={() => {
          setDropDate(undefined);
        }}
        onKeyDown={(event) => {
          if (!carrying && event.key === "Enter") {
            event.preventDefault();
            onOpen(task.id);
            return;
          }
          if (!task.canEdit || pending) return;
          if (!carrying && event.key === " ") {
            event.preventDefault();
            setCarrying({ task, date: dueOf(task) });
            setAnnouncement(
              `Picked up ${task.name}. Use the arrow keys to choose a day, Enter to drop, Escape to cancel.`,
            );
            return;
          }
          if (!isCarried) return;
          const step: Record<string, number> = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -7,
            ArrowDown: 7,
          };
          if (event.key in step) {
            event.preventDefault();
            const next = addDays(carrying.date ?? today, step[event.key]);
            setCarrying({ task, date: next });
            setAnnouncement(dayLabel(next));
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            move(task, carrying.date);
            setCarrying(null);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setCarrying(null);
            setAnnouncement(`Cancelled moving ${task.name}`);
          }
        }}
      >
        <span
          className="calendar-chip-dot"
          style={option?.color ? { backgroundColor: option.color } : undefined}
        />
        <span className="calendar-chip-name">
          {task.name}
          {task.parentName ? (
            <small className="block text-muted-foreground">
              Subitem of {task.parentName}
            </small>
          ) : null}
        </span>
        {initials(task) && (
          <span className="calendar-chip-people" aria-hidden="true">
            {initials(task)}
          </span>
        )}
      </div>
    );
  };
  // Drop zones read the task id from the drag data rather than React state,
  // which may not have updated yet when the first dragover arrives.
  const dragMime = "application/x-yuzu-task";
  const dropTarget = (date: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(dragMime)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropDate !== date) setDropDate(date);
    },
    onDragLeave: () => setDropDate(undefined),
    onDrop: (event: React.DragEvent) => {
      const id = event.dataTransfer.getData(dragMime);
      if (!id) return;
      event.preventDefault();
      const task = allTasks.find((item) => item.id === id);
      if (task) move(task, date);
      setDropDate(undefined);
    },
  });
  const weekdays = grid.days.slice(0, 7).map((date) =>
    new Intl.DateTimeFormat("en", {
      weekday: "short",
      timeZone: "UTC",
    }).format(parseISODate(date)),
  );
  const title = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseISODate(`${shown}-01`));
  return (
    <div className="board-calendar">
      <p role="status" aria-live="assertive" className="sr-only">
        {announcement}
      </p>
      <div className="calendar-toolbar">
        <h2>{title}</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => onMonthChange(shiftMonth(shown, -1))}
          >
            <ChevronLeft size={18} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onMonthChange(today.slice(0, 7))}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => onMonthChange(shiftMonth(shown, 1))}
          >
            <ChevronRight size={18} />
          </Button>
        </div>
      </div>
      {query.error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          Could not load the calendar. {query.error.message}
        </p>
      )}
      <div className="calendar-layout">
        <div className="calendar-grid" aria-busy={query.isFetching}>
          {weekdays.map((name) => (
            <div key={name} className="calendar-weekday" aria-hidden="true">
              {name}
            </div>
          ))}
          {grid.days.map((date) => {
            const tasks = byDay.get(date) ?? [];
            const { shown: visible, more } = daySlots(tasks, dayTotal(date));
            const outside = !date.startsWith(shown);
            return (
              <section
                key={date}
                aria-label={dayLabel(date)}
                className="calendar-day"
                data-outside={outside || undefined}
                data-today={date === today || undefined}
                data-drop={
                  dropDate === date || carrying?.date === date || undefined
                }
                {...dropTarget(date)}
              >
                <div className="calendar-day-head">
                  <span className="calendar-day-number">
                    {Number(date.slice(8))}
                  </span>
                  <button
                    type="button"
                    className="calendar-add"
                    aria-label={`Add task on ${dayLabel(date)}`}
                    disabled={pending}
                    onClick={() => onCreate(date)}
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <div className="calendar-day-tasks">
                  {visible.map(chip)}
                  {dayTotal(date) > 0 && (
                    <Popover.Root
                      open={openDay === date}
                      onOpenChange={(open) => setOpenDay(open ? date : null)}
                    >
                      <Popover.Anchor className="calendar-anchor" />
                      {more > 0 && (
                        <button
                          type="button"
                          className="calendar-more"
                          aria-haspopup="dialog"
                          aria-expanded={openDay === date}
                          onClick={(event) => {
                            opener.current = event.currentTarget;
                            setOpenDay(date);
                          }}
                        >
                          +{more} more
                        </button>
                      )}
                      {/* Phones show a count instead of unreadably narrow chips. */}
                      <button
                        type="button"
                        className="calendar-day-count"
                        aria-haspopup="dialog"
                        aria-expanded={openDay === date}
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          setOpenDay(date);
                        }}
                        aria-label={`${dayTotal(date)} ${dayTotal(date) === 1 ? "task" : "tasks"} on ${dayLabel(date)}`}
                      >
                        {dayTotal(date)}
                      </button>
                      <Popover.Portal>
                        <Popover.Content
                          className="calendar-popover"
                          sideOffset={6}
                          collisionPadding={12}
                          onCloseAutoFocus={(event) => {
                            event.preventDefault();
                            opener.current?.focus();
                          }}
                          aria-label={`Tasks on ${dayLabel(date)}`}
                        >
                          <p className="mb-2 text-xs font-semibold">
                            {dayLabel(date)}
                          </p>
                          <div className="grid gap-1">{tasks.map(chip)}</div>
                          {dayTotal(date) > tasks.length && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {dayTotal(date) - tasks.length} more match. Narrow
                              the filters to see them.
                            </p>
                          )}
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <section
          aria-labelledby="calendar-undated"
          className="calendar-undated"
          data-drop={dropDate === null || undefined}
          {...dropTarget(null)}
        >
          <h3 id="calendar-undated">No due date</h3>
          {undated.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Every matching task has a date.
            </p>
          ) : (
            <div className="grid gap-1">{undated.map(chip)}</div>
          )}
          {(data?.undatedTotal ?? 0) > (data?.undated.length ?? 0) && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing {data!.undated.length} of {data!.undatedTotal}. Use the
              table to see the rest.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
