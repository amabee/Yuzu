import { describe, expect, it } from "vitest";
import {
  adjustSpan,
  overlaps,
  shiftWindow,
  taskSpan,
  timelineQuerySchema,
  timelineRows,
  timelineWindow,
} from "./timeline-contract";
import { defaultViewConfig } from "./saved-view-contract";
import type { BoardTask } from "./board-contract";

const task = (id: string, extra: Partial<BoardTask> = {}): BoardTask => ({
  id,
  name: id,
  description: "",
  checklist: [],
  statusId: null,
  priority: "NORMAL",
  startDate: null,
  dueDate: null,
  groupId: null,
  createdById: "u",
  createdByName: "U",
  revision: 1,
  archivedAt: null,
  assigneeIds: [],
  editorIds: [],
  fieldValues: {},
  canEdit: true,
  activity: [],
  ...extra,
});

describe("timeline contract", () => {
  it("treats a single date as a one-day marker and no dates as unscheduled", () => {
    expect(
      taskSpan({ startDate: "2026-10-12", dueDate: "2026-10-16" }),
    ).toEqual({ start: "2026-10-12", end: "2026-10-16", marker: false });
    expect(taskSpan({ startDate: null, dueDate: "2026-10-16" })).toEqual({
      start: "2026-10-16",
      end: "2026-10-16",
      marker: true,
    });
    expect(taskSpan({ startDate: "2026-10-12", dueDate: null })?.marker).toBe(
      true,
    );
    expect(taskSpan({ startDate: null, dueDate: null })).toBeNull();
  });

  it("finds spans that touch the window at either edge", () => {
    const span = { start: "2026-10-01", end: "2026-10-10" };
    expect(overlaps(span, "2026-10-10", "2026-10-20")).toBe(true);
    expect(overlaps(span, "2026-09-20", "2026-10-01")).toBe(true);
    expect(overlaps(span, "2026-10-11", "2026-10-20")).toBe(false);
  });

  it("builds week and month windows on whole periods", () => {
    // Sunday 18 October 2026, weeks starting Monday.
    expect(timelineWindow("2026-10-18", "weeks", 1)).toEqual({
      from: "2026-10-05",
      to: "2026-11-08",
    });
    expect(timelineWindow("2026-10-18", "weeks", 0)).toEqual({
      from: "2026-10-11",
      to: "2026-11-14",
    });
    expect(timelineWindow("2026-10-18", "months", 1)).toEqual({
      from: "2026-09-01",
      to: "2027-02-28",
    });
    expect(shiftWindow("2026-09-01", "months", 1)).toBe("2027-03-01");
    expect(shiftWindow("2026-10-05", "weeks", -1)).toBe("2026-08-31");
  });

  it("limits the window to about six months", () => {
    const query = (from: string, to: string) =>
      timelineQuerySchema.safeParse({ config: defaultViewConfig, from, to })
        .success;
    expect(query("2026-09-01", "2027-02-28")).toBe(true);
    expect(query("2026-09-01", "2027-03-31")).toBe(false);
    expect(query("2026-10-10", "2026-10-01")).toBe(false);
  });

  it("moves and resizes spans without letting them invert", () => {
    const span = { start: "2026-10-12", end: "2026-10-16" };
    expect(adjustSpan(span, "move", 3)).toEqual({
      start: "2026-10-15",
      end: "2026-10-19",
    });
    expect(adjustSpan(span, "end", -2)).toEqual({
      start: "2026-10-12",
      end: "2026-10-14",
    });
    expect(adjustSpan(span, "end", -9).end).toBe("2026-10-12");
    expect(adjustSpan(span, "start", 9).start).toBe("2026-10-16");
  });

  it("groups rows in board order and splits shared assignments", () => {
    const labels = {
      groups: [
        { id: "g1", name: "Design" },
        { id: "g2", name: "Build" },
      ],
      statuses: [{ id: "done", label: "Done" }],
      people: [
        { id: "p1", name: "Mia" },
        { id: "p2", name: "Lee" },
      ],
    };
    const tasks = [
      task("a", { groupId: "g2", assigneeIds: ["p1", "p2"] }),
      task("b", { groupId: "g1" }),
      task("c"),
    ];
    expect(
      timelineRows(tasks, "group", labels).map((row) => row.label),
    ).toEqual(["Design", "Build", "No group"]);
    expect(
      timelineRows(tasks, "assignee", labels).map((row) => [
        row.label,
        row.tasks.length,
      ]),
    ).toEqual([
      ["Lee", 1],
      ["Mia", 1],
      ["Unassigned", 2],
    ]);
  });
});
