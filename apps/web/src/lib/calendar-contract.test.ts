import { describe, expect, it } from "vitest";
import {
  calendarQuerySchema,
  daySlots,
  monthGrid,
  shiftMonth,
} from "./calendar-contract";
import { defaultViewConfig } from "./saved-view-contract";

const query = (from: string, to: string) =>
  calendarQuerySchema.safeParse({ config: defaultViewConfig, from, to });

describe("calendar contract", () => {
  it("accepts a 6-week range and rejects longer, reversed or fake dates", () => {
    expect(query("2026-09-28", "2026-11-08").success).toBe(true);
    expect(query("2026-09-28", "2026-11-09").success).toBe(false);
    expect(query("2026-10-10", "2026-10-01").success).toBe(false);
    expect(query("2026-02-30", "2026-03-01").success).toBe(false);
  });

  it("builds whole weeks around the month for either week start", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const monday = monthGrid("2026-10", 1);
    expect(monday).toMatchObject({ from: "2026-09-28", to: "2026-11-01" });
    expect(monday.days).toHaveLength(35);
    const sunday = monthGrid("2026-10", 0);
    expect(sunday).toMatchObject({ from: "2026-09-27", to: "2026-10-31" });
  });

  it("handles leap years and months that need six rows", () => {
    expect(monthGrid("2028-02", 1).days).toContain("2028-02-29");
    // August 2026 starts on a Saturday: six Monday-first rows.
    expect(monthGrid("2026-08", 1).days).toHaveLength(42);
    for (const month of ["2026-01", "2026-05", "2027-12"])
      expect(monthGrid(month, 0).days.length % 7).toBe(0);
  });

  it("moves between months across years", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("counts hidden tasks, including ones the server left out", () => {
    expect(daySlots(["a", "b", "c", "d"], 9)).toEqual({
      shown: ["a", "b", "c"],
      more: 6,
    });
    expect(daySlots(["a"], 1)).toEqual({ shown: ["a"], more: 0 });
  });
});
