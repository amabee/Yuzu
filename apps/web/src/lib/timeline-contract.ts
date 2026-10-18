import { z } from "zod";
import { viewConfigSchema } from "./saved-view-contract";
import {
  addDays,
  daysBetween,
  parseISODate,
  toISODate,
} from "./calendar-contract";
import type { BoardTask } from "./board-contract";

export const TIMELINE_TASK_LIMIT = 600;
export const TIMELINE_MAX_DAYS = 186;
export type TimelineZoom = "weeks" | "months";
export type TimelineGroupBy = "group" | "status" | "assignee";

/** Pixels per day for each zoom. */
export const dayWidth: Record<TimelineZoom, number> = { weeks: 36, months: 6 };

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => toISODate(parseISODate(value)) === value,
    "Use a real calendar date.",
  );
export const timelineFromSchema = isoDate;

export const timelineQuerySchema = z
  .strictObject({ config: viewConfigSchema, from: isoDate, to: isoDate })
  .refine((query) => query.from <= query.to, "The range ends before it starts.")
  .refine(
    (query) => daysBetween(query.from, query.to) < TIMELINE_MAX_DAYS,
    `Show at most ${TIMELINE_MAX_DAYS} days at a time.`,
  );

export type BoardTimeline = {
  from: string;
  to: string;
  tasks: BoardTask[];
  /** Matching tasks in the window, including any beyond the task limit. */
  total: number;
  unscheduled: BoardTask[];
  unscheduledTotal: number;
};

/** The days a task covers. One date alone is a single-day marker. */
export function taskSpan(task: {
  startDate: string | null;
  dueDate: string | null;
}) {
  const start = task.startDate ?? task.dueDate;
  const end = task.dueDate ?? task.startDate;
  if (!start || !end) return null;
  return { start, end, marker: !task.startDate || !task.dueDate };
}

export function overlaps(
  span: { start: string; end: string },
  from: string,
  to: string,
) {
  return span.start <= to && span.end >= from;
}

/** The visible window: whole weeks for Weeks zoom (5 weeks), whole months for
 *  Months zoom (6 months), containing `anchor`. */
export function timelineWindow(
  anchor: string,
  zoom: TimelineZoom,
  weekStartsOn: 0 | 1,
) {
  if (zoom === "weeks") {
    const lead = (parseISODate(anchor).getUTCDay() - weekStartsOn + 7) % 7;
    // Start one week before the anchor's week so earlier context shows.
    const from = addDays(anchor, -lead - 7);
    return { from, to: addDays(from, 34) };
  }
  const start = parseISODate(`${anchor.slice(0, 7)}-01`);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 6);
  return { from: toISODate(start), to: addDays(toISODate(end), -1) };
}

/** Moves the window by one whole window in either direction. */
export function shiftWindow(
  from: string,
  zoom: TimelineZoom,
  direction: -1 | 1,
) {
  if (zoom === "weeks") return addDays(from, direction * 35);
  const date = parseISODate(from);
  date.setUTCMonth(date.getUTCMonth() + direction * 6);
  return toISODate(date);
}

/** Moves a span by whole days, or one end of it, keeping start <= end. */
export function adjustSpan(
  span: { start: string; end: string },
  edit: "move" | "start" | "end",
  days: number,
) {
  if (edit === "move")
    return { start: addDays(span.start, days), end: addDays(span.end, days) };
  if (edit === "start") {
    const start = addDays(span.start, days);
    return { start: start > span.end ? span.end : start, end: span.end };
  }
  const end = addDays(span.end, days);
  return { start: span.start, end: end < span.start ? span.start : end };
}

export type TimelineRow = { id: string; label: string; tasks: BoardTask[] };

/** Groups tasks into labeled rows; tasks with several assignees appear once
 *  per assignee so each person's load is visible. */
export function timelineRows(
  tasks: BoardTask[],
  groupBy: TimelineGroupBy,
  labels: {
    groups: { id: string; name: string }[];
    statuses: { id: string; label: string }[];
    people: { id: string; name: string }[];
  },
): TimelineRow[] {
  const rows = new Map<string, TimelineRow>();
  const add = (id: string, label: string, task: BoardTask) => {
    const row = rows.get(id) ?? { id, label, tasks: [] };
    row.tasks.push(task);
    rows.set(id, row);
  };
  const ordered = (ids: string[]) =>
    [...rows.values()].sort(
      (a, b) =>
        (ids.indexOf(a.id) === -1 ? 1e6 : ids.indexOf(a.id)) -
        (ids.indexOf(b.id) === -1 ? 1e6 : ids.indexOf(b.id)),
    );
  for (const task of tasks) {
    if (groupBy === "group") {
      const group = labels.groups.find((item) => item.id === task.groupId);
      add(group?.id ?? "none", group?.name ?? "No group", task);
    } else if (groupBy === "status") {
      const status = labels.statuses.find((item) => item.id === task.statusId);
      add(status?.id ?? "none", status?.label ?? "No status", task);
    } else if (!task.assigneeIds.length) add("none", "Unassigned", task);
    else
      for (const id of task.assigneeIds)
        add(
          id,
          labels.people.find((person) => person.id === id)?.name ??
            "Former member",
          task,
        );
  }
  if (groupBy === "group") return ordered(labels.groups.map((g) => g.id));
  if (groupBy === "status")
    return ordered(labels.statuses.map((status) => status.id));
  return [...rows.values()].sort((a, b) =>
    a.id === "none" ? 1 : b.id === "none" ? -1 : a.label.localeCompare(b.label),
  );
}
