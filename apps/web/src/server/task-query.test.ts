import { describe, it, expect } from "vitest";
import { taskWhere, taskOrder } from "./task-query";
import { defaultViewConfig } from "@/lib/saved-view-contract";
import { boardQuerySchema, calendarWindow } from "@/lib/board-query";

describe("database task filtering", () => {
  it("uses literal wildcard characters and applies all saved-view predicates in the database", () => {
    expect(
      taskWhere(
        "board",
        {
          ...defaultViewConfig,
          search: "50%_\\",
          assignee: "me",
          due: "next-week",
          priority: "HIGH",
          statusId: "__none__",
          groupId: "group",
        },
        "me",
        "2026-12-29",
      ),
    ).toMatchObject({
      boardId: "board",
      archivedAt: null,
      statusId: null,
      groupId: "group",
      priority: "HIGH",
      assignees: { some: { userId: "me" } },
      dueDate: {
        gte: new Date("2026-12-29T00:00:00Z"),
        lte: new Date("2027-01-05T00:00:00Z"),
      },
      OR: [
        { name: { contains: "50\\%\\_\\\\", mode: "insensitive" } },
        { description: { contains: "50\\%\\_\\\\", mode: "insensitive" } },
      ],
    });
  });
  it("keeps stable tie breakers, missing dates last, and bounds page inputs", () => {
    expect(taskOrder("due")).toEqual([
      { dueDate: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ]);
    expect(taskOrder("name").at(-1)).toEqual({ id: "asc" });
    for (const page of [0, -1, 1.5, 1_000_001])
      expect(boardQuerySchema.safeParse({ page }).success).toBe(false);
    expect(calendarWindow("2028-02-27").end.toISOString()).toBe(
      "2028-03-05T00:00:00.000Z",
    );
  });
});

it("keeps root-only board predicates flat so large root counts need no ancestor joins", () => {
  const where = taskWhere("board", defaultViewConfig, "me", "2026-10-25");
  expect(where).toMatchObject({
    parentId: null,
    deletedAt: null,
    archivedAt: null,
  });
  expect(where).not.toHaveProperty("AND");
  expect(where).not.toHaveProperty("parent");
});
