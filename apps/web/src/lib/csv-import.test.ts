import { describe, expect, it } from "vitest";
import {
  importMappingSchema,
  mapImportRow,
  parseImportCsv,
  suggestImportMapping,
  MAX_IMPORT_BYTES,
  type ImportContext,
} from "./csv-import";
const id = "0199a500-0000-7000-8000-000000000001";
const fieldId = "0199a500-0000-7000-8000-000000000002";
const context: ImportContext = {
  fields: [
    {
      id,
      key: "status",
      name: "Status",
      type: "STATUS",
      version: "",
      options: [{ id: "todo", label: "To do" }],
    },
    {
      id: fieldId,
      key: "tags",
      name: "Tags",
      type: "TAGS",
      version: "",
      options: [
        { id: "dev", label: "Development" },
        { id: "ux", label: "Design" },
      ],
    },
  ],
  groups: [{ id, name: "Sprint one" }],
  people: [{ id, name: "Angel" }],
};
describe("CSV import parsing and mapping", () => {
  it("uses saved priority labels and preserves custom text whitespace", () => {
    const model = {
      ...context,
      fields: [
        ...context.fields,
        {
          id: "0199a500-0000-7000-8000-000000000003",
          key: "priority",
          name: "Priority",
          type: "PRIORITY",
          version: "",
          options: [{ id: "NORMAL", label: "Routine" }],
        },
        {
          id: "0199a500-0000-7000-8000-000000000004",
          key: "notes",
          name: "Notes",
          type: "LONG_TEXT",
          version: "",
          options: [],
        },
      ],
    };
    const row = mapImportRow(
      ["Task", "routine", "  Keep spacing\n  "],
      [
        { column: 0, target: "name" },
        { column: 1, target: "priority" },
        { column: 2, target: model.fields[3].id },
      ],
      model,
      id,
      () => id,
    );
    expect(row.issues).toEqual([]);
    expect(row.input).toMatchObject({
      priority: "NORMAL",
      fieldValues: { [model.fields[3].id]: "  Keep spacing\n  " },
    });
  });
  it("reads BOM, CRLF, escaped quotes, multiline Unicode and trailing empty cells", () => {
    expect(
      parseImportCsv(
        '\ufeffTask,Description,Status\r\n"Lemon 🍋","Line 1\nLine ""2""",\r\n',
      ),
    ).toEqual({
      headers: ["Task", "Description", "Status"],
      rows: [["Lemon 🍋", 'Line 1\nLine "2"', ""]],
    });
  });
  it.each([
    'Task\n"open',
    'Task\nno"quote',
    'Task\n"closed"junk',
    "Task,Status\nName",
    "Task,\nName,",
    "Task\n",
    "Task\nN\0ame",
  ])("rejects malformed CSV: %s", (csv) => {
    expect(() => parseImportCsv(csv)).toThrow();
  });
  it("bounds UTF-8 bytes, rows and columns before importing", () => {
    expect(() =>
      parseImportCsv(`Task\n${"🍋".repeat(MAX_IMPORT_BYTES / 4)}`),
    ).toThrow(/1 MB/);
    expect(() => parseImportCsv(`Task\n${"task\n".repeat(501)}`)).toThrow(
      /500/,
    );
    expect(() =>
      parseImportCsv(
        `${Array(101).fill("Header").join(",")}\n${Array(101).fill("value").join(",")}`,
      ),
    ).toThrow(/100/);
  });
  it("suggests unique destinations and ignores export-only metadata", () => {
    expect(
      suggestImportMapping(
        [
          "Task",
          "Title",
          "Status",
          "Tags",
          "Revision",
          "Archived at",
          "Task ID",
        ],
        context,
      ),
    ).toEqual([
      { column: 0, target: "name" },
      { column: 2, target: "status" },
      { column: 3, target: fieldId },
      { column: 6, target: "source_id" },
    ]);
    expect(
      importMappingSchema.safeParse([
        { column: 0, target: "name" },
        { column: 1, target: "name" },
      ]).success,
    ).toBe(false);
    expect(
      importMappingSchema.safeParse([
        { column: 0, target: "name" },
        { column: 0, target: "status" },
      ]).success,
    ).toBe(false);
  });
  it("resolves labels and IDs without creating new board options", () => {
    const row = mapImportRow(
      [
        "Title",
        "to DO",
        '["Development","ux"]',
        "Angel",
        "Sprint one",
        "Step one|Step two",
        "2026-10-16",
      ],
      [
        { column: 0, target: "name" },
        { column: 1, target: "status" },
        { column: 2, target: fieldId },
        { column: 3, target: "assignees" },
        { column: 4, target: "group" },
        { column: 5, target: "checklist" },
        { column: 6, target: "due_date" },
      ],
      context,
      id,
      () => id,
    );
    expect(row.issues).toEqual([expect.stringContaining("unique ID")]); // The injected ID factory must be unique, too.
    const valid = mapImportRow(
      [
        "Title",
        "todo",
        '["Development","Design"]',
        '[{"text":"Draft","done":true}]',
      ],
      [
        { column: 0, target: "name" },
        { column: 1, target: "status" },
        { column: 2, target: fieldId },
        { column: 3, target: "checklist" },
      ],
      context,
      id,
      () => id,
    );
    expect(valid.issues).toEqual([]);
    expect(valid.input).toMatchObject({
      name: "Title",
      statusId: "todo",
      fieldValues: { [fieldId]: ["dev", "ux"] },
      checklist: [{ text: "Draft", done: true, id }],
    });
  });
  it("keeps zero, false and numeric negatives while rejecting invalid scalar formats", () => {
    const number = { ...context.fields[1], type: "NUMBER" },
      checkbox = { ...number, id, type: "CHECKBOX" };
    const model = { ...context, fields: [number, checkbox] };
    const mapping = [
      { column: 0, target: "name" },
      { column: 1, target: fieldId },
      { column: 2, target: id },
    ];
    expect(
      mapImportRow(["Task", "0", "false"], mapping, model, id, () => id).input
        ?.fieldValues,
    ).toEqual({ [fieldId]: 0, [id]: false });
    expect(
      mapImportRow(["Task", "-2.5", "yes"], mapping, model, id, () => id).input
        ?.fieldValues,
    ).toEqual({ [fieldId]: -2.5, [id]: true });
    expect(
      mapImportRow(["Task", "$2", "maybe"], mapping, model, id, () => id)
        .issues,
    ).toHaveLength(2);
  });
  it("flags impossible dates, unknown options, ambiguous people and empty names", () => {
    const mapping = [
      { column: 0, target: "name" },
      { column: 1, target: "due_date" },
      { column: 2, target: "status" },
      { column: 3, target: "assignees" },
    ];
    const row = mapImportRow(
      ["", "2026-02-30", "Missing", "Angel"],
      mapping,
      {
        ...context,
        people: [...context.people, { id: fieldId, name: "Angel" }],
      },
      id,
      () => id,
    );
    expect(row.issues).toHaveLength(4);
    expect(row.input).toBeNull();
  });
  it("preserves text as text and never treats spreadsheet formulas as executable input", () => {
    expect(
      mapImportRow(
        ["=SUM(1,2)", "  plain <b>text</b>\n  "],
        [
          { column: 0, target: "name" },
          { column: 1, target: "description" },
        ],
        context,
        id,
        () => id,
      ).input,
    ).toMatchObject({
      name: "=SUM(1,2)",
      description: "  plain <b>text</b>\n  ",
    });
  });
});
