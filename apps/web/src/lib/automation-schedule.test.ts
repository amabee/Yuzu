import { describe, expect, it } from "vitest";
import {
  latestOccurrence,
  nextOccurrence,
  scheduleSchema,
  zonedTime,
} from "./automation-schedule";

const at = (iso: string) => new Date(iso);

describe("schedule occurrences", () => {
  it("converts wall time in a timezone, including daylight saving", () => {
    expect(zonedTime(2026, 10, 27, 9, 0, "Asia/Singapore").toISOString()).toBe(
      "2026-10-27T01:00:00.000Z",
    );
    // New York: EDT (UTC-4) in October, EST (UTC-5) after November 1.
    expect(
      zonedTime(2026, 10, 20, 9, 0, "America/New_York").toISOString(),
    ).toBe("2026-10-20T13:00:00.000Z");
    expect(zonedTime(2026, 11, 3, 9, 0, "America/New_York").toISOString()).toBe(
      "2026-11-03T14:00:00.000Z",
    );
  });

  it("finds the next and latest weekly run in the installation timezone", () => {
    const mondays = { every: "week" as const, days: [1], time: "09:00" };
    // Sunday 2026-10-25 10:00 in Singapore.
    const now = at("2026-10-25T02:00:00Z");
    expect(nextOccurrence(mondays, now, "Asia/Singapore")?.toISOString()).toBe(
      "2026-10-26T01:00:00.000Z",
    );
    expect(
      latestOccurrence(mondays, now, "Asia/Singapore")?.toISOString(),
    ).toBe("2026-10-19T01:00:00.000Z");
  });

  it("skips weekends for weekdays and clamps months to their last day", () => {
    // Saturday 2026-10-24 12:00 UTC.
    expect(
      nextOccurrence(
        { every: "weekday", time: "08:30" },
        at("2026-10-24T12:00:00Z"),
        "UTC",
      )?.toISOString(),
    ).toBe("2026-10-26T08:30:00.000Z");
    expect(
      nextOccurrence(
        { every: "month", date: 31, time: "09:00" },
        at("2026-11-02T00:00:00Z"),
        "UTC",
      )?.toISOString(),
    ).toBe("2026-11-30T09:00:00.000Z");
  });

  it("requires days for weekly and a date for monthly schedules", () => {
    expect(
      scheduleSchema.safeParse({ every: "week", time: "09:00" }).success,
    ).toBe(false);
    expect(
      scheduleSchema.safeParse({ every: "month", time: "09:00" }).success,
    ).toBe(false);
    expect(
      scheduleSchema.safeParse({ every: "day", time: "9:00" }).success,
    ).toBe(false);
  });
});
