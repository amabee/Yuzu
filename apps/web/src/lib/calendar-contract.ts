import { z } from "zod";
import { viewConfigSchema } from "./saved-view-contract";
import type { BoardTask } from "./board-contract";

/** Tasks returned for one visible calendar range; busier ranges report the
 *  rest as per-day counts so each day can still say "+N more". */
export const CALENDAR_TASK_LIMIT = 600;
export const CALENDAR_MAX_DAYS = 42;
export const weekStarts = [0, 1] as const; // Sunday, Monday

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => toISODate(parseISODate(value)) === value,
    "Use a real calendar date.",
  );

export const calendarQuerySchema = z
  .strictObject({
    config: viewConfigSchema,
    from: isoDate,
    to: isoDate,
  })
  .refine((query) => query.from <= query.to, "The range ends before it starts.")
  .refine(
    (query) => daysBetween(query.from, query.to) < CALENDAR_MAX_DAYS,
    `Show at most ${CALENDAR_MAX_DAYS} days at a time.`,
  );
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const calendarMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// Dates are calendar days with no time zone, handled as UTC midnights.
export function parseISODate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}
export function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}
export function addDays(value: string, days: number) {
  const date = parseISODate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}
export function daysBetween(from: string, to: string) {
  return Math.round(
    (parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000,
  );
}

/** The weeks shown for a month: from the week containing the 1st to the week
 *  containing the last day, so 4 to 6 rows of 7 days. */
export function monthGrid(month: string, weekStartsOn: 0 | 1) {
  const first = `${month}-01`;
  const start = parseISODate(first);
  const lead = (start.getUTCDay() - weekStartsOn + 7) % 7;
  const from = addDays(first, -lead);
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(toISODate(next), -1);
  const trail = (weekStartsOn + 6 - parseISODate(last).getUTCDay() + 7) % 7;
  const to = addDays(last, trail);
  const days = Array.from({ length: daysBetween(from, to) + 1 }, (_, index) =>
    addDays(from, index),
  );
  return { from, to, days };
}

export function shiftMonth(month: string, offset: number) {
  const date = parseISODate(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return toISODate(date).slice(0, 7);
}

/** Splits a day's tasks into the visible chips and an overflow count that
 *  includes tasks the server left out of a capped range. */
export function daySlots<T>(tasks: T[], total: number, visible = 3) {
  const shown = tasks.slice(0, visible);
  return { shown, more: Math.max(0, total - shown.length) };
}

export type BoardCalendar = {
  from: string;
  to: string;
  /** Today in the installation's timezone. */
  today: string;
  weekStartsOn: 0 | 1;
  tasks: BoardTask[];
  /** All matching tasks per day, including any beyond the task limit. */
  dayCounts: Record<string, number>;
  undated: BoardTask[];
  undatedTotal: number;
};
