import { describe, expect, it } from "vitest";
import {
  csvCell,
  csvHeaders,
  csvLine,
  csvTaskCells,
  csvFilename,
  type CsvContext,
  type CsvTask,
} from "./csv-export";
import { matchesBoardView, compareBoardView } from "./board-view";
import { defaultViewConfig } from "./saved-view-contract";

describe("CSV spreadsheet compatibility and safety", () => {
  it("quotes commas, line breaks, quotes and Unicode without losing data", () => {
    expect(
      csvLine(['Hello, "Yuzu"', "line one\r\nline two", "柚子 🍋", null]),
    ).toBe('"Hello, ""Yuzu""","line one\r\nline two","柚子 🍋",""\r\n');
    expect(csvCell(false)).toBe('"FALSE"');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell(-12.5)).toBe('"-12.5"');
  });
  it("neutralizes formula prefixes even behind whitespace and control characters", () => {
    for (const value of [
      "=1+1",
      "+SUM(A1)",
      "-cmd()",
      "@SUM(1)",
      '  =HYPERLINK("x")',
      "\u0000\u0001=1",
      "\ttext",
      "\ntext",
      "\rtext",
      "\ufeff@SUM(1)",
    ]) {
      expect(csvCell(value).startsWith("\"'")).toBe(true);
    }
    expect(csvCell("ordinary @mention")).toBe('"ordinary @mention"');
    expect(csvCell("https://example.com")).toBe('"https://example.com"');
  });
  it("disambiguates custom headers and preserves typed values, options and task checklists", () => {
    const fields: CsvContext["fields"] = [
      {
        id: "status",
        key: "status",
        name: "Status",
        version: "1",
        type: "STATUS",
        options: [{ id: "doing", label: "In progress" }],
      },
      ...["Task", "task", "Estimate", "Ready", "Tags", "People", "Select"].map(
        (name, i) => ({
          id: `field${i}`,
          key: `custom${i}`,
          name,
          version: "1",
          type: [
            "TEXT",
            "TEXT",
            "NUMBER",
            "CHECKBOX",
            "TAGS",
            "PEOPLE",
            "SINGLE_SELECT",
          ][i]!,
          options: i === 4 || i === 6 ? [{ id: "a", label: "A, B" }] : [],
        }),
      ),
    ];
    const context: CsvContext = {
      fields,
      groups: [{ id: "group", name: "Sprint" }],
      people: [{ id: "person", name: "Jane, Doe" }],
    };
    const task: CsvTask = {
      id: "task",
      name: "Work",
      description: "",
      statusId: "doing",
      priority: "HIGH",
      dueDate: "2026-10-16",
      archivedAt: null,
      groupId: "group",
      assigneeIds: ["person"],
      revision: 2,
      createdByName: "Creator",
      checklist: [{ id: "item", text: "Unique checklist", done: false }],
      fieldValues: {
        field0: "",
        field1: "text",
        field2: 0,
        field3: false,
        field4: ["a"],
        field5: ["person"],
        field6: "a",
      },
    };
    const headers = csvHeaders(fields);
    expect(new Set(headers.map((name) => name.toLowerCase())).size).toBe(
      headers.length,
    );
    expect(headers).toContain("Task (2)");
    expect(headers).toContain("task (3)");
    const cells = csvTaskCells(task, context);
    const row = Object.fromEntries(headers.map((name, i) => [name, cells[i]]));
    expect(row).toMatchObject({
      Status: "In progress",
      Group: "Sprint",
      Assignees: '["Jane, Doe"]',
      Estimate: 0,
      Ready: false,
      Tags: '["A, B"]',
      People: '["Jane, Doe"]',
      Select: "A, B",
    });
    expect(JSON.parse(String(row.Checklist))).toEqual([
      { text: "Unique checklist", done: false },
    ]);
    expect(() =>
      encodeURIComponent(csvFilename("x" + "🍋".repeat(49), "2026-10-16")),
    ).not.toThrow();
    expect(csvFilename('Board/"demo"\r\n', "2026-10-16")).not.toMatch(
      /[\r\n/"\\]/u,
    );
  });
  it("matches the current view with viewer-relative assignment, search, archive state and sorting", () => {
    const task = {
      id: "a",
      name: "Work",
      description: "release",
      archivedAt: null,
      statusId: "doing",
      assigneeIds: ["me"],
      priority: "HIGH",
      dueDate: "2026-10-20",
      groupId: "g",
    };
    const config = {
      ...defaultViewConfig,
      search: "Work release",
      statusId: "doing",
      assignee: "me" as const,
      priority: "HIGH" as const,
      groupId: "g",
      due: "next-week" as const,
    };
    expect(matchesBoardView(task, config, "me", "2026-10-16")).toBe(true);
    expect(matchesBoardView(task, config, "someone-else", "2026-10-16")).toBe(
      false,
    );
    expect(
      matchesBoardView(
        { ...task, archivedAt: "2026-10-16" },
        config,
        "me",
        "2026-10-16",
      ),
    ).toBe(false);
    expect(
      matchesBoardView(
        task,
        { ...config, statusId: "__none__" },
        "me",
        "2026-10-16",
      ),
    ).toBe(false);
    expect(
      compareBoardView(task, { ...task, dueDate: null }, "due"),
    ).toBeLessThan(0);
    expect(
      compareBoardView({ ...task, name: "A" }, { ...task, name: "B" }, "name"),
    ).toBeLessThan(0);
  });
});
