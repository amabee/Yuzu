import { z } from "zod";

/** When a scheduled rule fires, in the installation timezone. */
export const scheduleSchema = z
  .object({
    every: z.enum(["day", "weekday", "week", "month"]),
    /** Days of the week for "week": 0 Sunday … 6 Saturday. */
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    /** Day of the month for "month"; short months use their last day. */
    date: z.number().int().min(1).max(31).optional(),
    /** 24-hour wall time, "HH:MM". */
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00."),
  })
  .strict()
  .refine(
    (value) => value.every !== "week" || Boolean(value.days?.length),
    "Choose at least one day.",
  )
  .refine(
    (value) => value.every !== "month" || value.date !== undefined,
    "Choose a day of the month.",
  );
export type Schedule = z.infer<typeof scheduleSchema>;

/** The UTC offset of `zone` at `instant`, in minutes. */
function offsetMinutes(instant: Date, zone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  const asUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The instant a wall-clock time happens in `zone`. */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string,
) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMinutes(new Date(guess), zone) * 60_000;
  // A second pass settles daylight-saving boundaries.
  return new Date(guess - offsetMinutes(new Date(first), zone) * 60_000);
}

/** The local calendar date of `instant` in `zone`. */
function localDate(instant: Date, zone: string) {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(instant)
    .split("-")
    .map(Number);
  return { year: year!, month: month!, day: day! };
}

function matchesDay(
  schedule: Schedule,
  year: number,
  month: number,
  day: number,
) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (schedule.every === "day") return true;
  if (schedule.every === "weekday") return weekday >= 1 && weekday <= 5;
  if (schedule.every === "week") return schedule.days!.includes(weekday);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day === Math.min(schedule.date!, last);
}

/** Occurrences from `from` stepping by day, newest first or oldest first. */
function occurrence(
  schedule: Schedule,
  now: Date,
  zone: string,
  direction: 1 | -1,
) {
  const [hour, minute] = schedule.time.split(":").map(Number);
  const start = localDate(now, zone);
  for (let step = 0; step <= 62; step++) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day));
    date.setUTCDate(date.getUTCDate() + step * direction);
    const [year, month, day] = [
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    ];
    if (!matchesDay(schedule, year, month, day)) continue;
    const at = zonedTime(year, month, day, hour!, minute!, zone);
    if (direction === -1 ? at <= now : at > now) return at;
  }
  return null;
}

/** The most recent time the schedule was due, at or before `now`. */
export function latestOccurrence(schedule: Schedule, now: Date, zone: string) {
  return occurrence(schedule, now, zone, -1);
}

/** The next time the schedule is due, after `now`. */
export function nextOccurrence(schedule: Schedule, now: Date, zone: string) {
  return occurrence(schedule, now, zone, 1);
}
