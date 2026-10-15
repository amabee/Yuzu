import { describe, expect, it } from "vitest";
import {
  defaultViewConfig,
  dueMatches,
  saveViewSchema,
  viewConfigSchema,
} from "./saved-view-contract";

describe("saved view filters", () => {
  it("bounds and validates persisted configuration", () => {
    expect(viewConfigSchema.parse(defaultViewConfig)).toEqual(
      defaultViewConfig,
    );
    expect(
      viewConfigSchema.safeParse({
        ...defaultViewConfig,
        search: "x".repeat(201),
      }).success,
    ).toBe(false);
    expect(
      viewConfigSchema.safeParse({ ...defaultViewConfig, groupId: "foreign" })
        .success,
    ).toBe(false);
    expect(
      viewConfigSchema.safeParse({ ...defaultViewConfig, sort: "sql" }).success,
    ).toBe(false);
    expect(
      viewConfigSchema.safeParse({ ...defaultViewConfig, admin: true }).success,
    ).toBe(false);
    expect(
      saveViewSchema.safeParse({
        boardId: "01900000-0000-7000-8000-000000000001",
        id: "01900000-0000-7000-8000-000000000002",
        revision: 0,
        name: "   ",
        visibility: "PERSONAL",
        config: defaultViewConfig,
      }).success,
    ).toBe(false);
  });
  it("uses inclusive calendar boundaries and handles missing dates", () => {
    const now = new Date(2026, 11, 29, 23, 59);
    expect(dueMatches("2026-12-28", "overdue", now)).toBe(true);
    expect(dueMatches("2026-12-29", "overdue", now)).toBe(false);
    expect(dueMatches("2026-12-29", "next-week", now)).toBe(true);
    expect(dueMatches("2027-01-05", "next-week", now)).toBe(true);
    expect(dueMatches("2027-01-06", "next-week", now)).toBe(false);
    expect(dueMatches(null, "next-week", now)).toBe(false);
    expect(dueMatches(null, "overdue", now)).toBe(false);
    expect(dueMatches(null, "none", now)).toBe(true);
    expect(dueMatches("2026-12-29", "none", now)).toBe(false);
    expect(dueMatches(null, "all", now)).toBe(true);
  });
});
