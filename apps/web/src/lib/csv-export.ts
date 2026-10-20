import {
  builtinLabels,
  builtinName,
  type BuiltinKey,
  type RecordConfig,
} from "./record-types";
import { z } from "zod";
import { recordId } from "./id-contract";
import {
  type BoardField,
  type FieldValue,
  type TaskChecklist,
  coreKeys,
} from "./board-contract";
import { viewConfigSchema } from "./saved-view-contract";
import type { ViewTask } from "./board-view";

export const MAX_CSV_TASKS = 10_000;
export const MAX_CSV_BYTES = 10_000_000;
export const exportCsvSchema = z.discriminatedUnion("scope", [
  z
    .object({
      boardId: recordId,
      scope: z.literal("VIEW"),
      config: viewConfigSchema,
    })
    .strict(),
  z
    .object({
      boardId: recordId,
      scope: z.literal("BOARD"),
      includeArchived: z.boolean(),
    })
    .strict(),
]);
export type CsvExportRequest = z.infer<typeof exportCsvSchema>;
export type CsvCell = string | number | boolean | null | undefined;

export function csvCell(value: CsvCell) {
  let text =
    value == null
      ? ""
      : typeof value === "boolean"
        ? value
          ? "TRUE"
          : "FALSE"
        : String(value);
  // Quoting CSV alone does not stop spreadsheet formulas. Keep numeric negatives numeric.
  const probe = text.replace(/^[\s\p{Cc}\p{Cf}]*/u, "");
  if (
    typeof value === "string" &&
    (/^[=+\-@]/u.test(probe) || /^[\t\r\n]/u.test(text))
  )
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export const csvLine = (cells: CsvCell[]) =>
  cells.map(csvCell).join(",") + "\r\n";
export const csvCoreHeaders = [
  "Task ID",
  "Task",
  "Description",
  "Status",
  "Priority",
  "Start date",
  "Due date",
  "Group",
  "Assignees",
  "Assignee IDs",
  "Checklist",
  "Archived at",
  "Revision",
  "Created by",
];

/** Which built-in each core column belongs to (null: always exported). */
const coreColumnBuiltin: (BuiltinKey | null)[] = [
  null,
  null,
  "description",
  "status",
  "priority",
  "startDate",
  "dueDate",
  null,
  "assignees",
  "assignees",
  "checklist",
  null,
  null,
  null,
];
/** Core columns for this board: its names, and only built-ins that are on. */
export function coreHeaders(record?: RecordConfig) {
  if (!record) return csvCoreHeaders;
  const named = csvCoreHeaders.map((header, index) => {
    if (index === 0) return `${record.singular} ID`;
    if (index === 1) return record.singular;
    const key = coreColumnBuiltin[index];
    if (!key) return header;
    // Fields with their default names keep the original headers, so Task
    // exports stay exactly as before and re-import cleanly.
    const name = builtinName(record, key);
    if (name === builtinLabels[key]) return header;
    return index === 9 ? `${name} IDs` : name;
  });
  return named.filter((_, index) => {
    const key = coreColumnBuiltin[index];
    return !key || record.builtins[key].on;
  });
}
const keepCore = (record: RecordConfig | undefined, index: number) => {
  const key = coreColumnBuiltin[index];
  return !record || !key || record.builtins[key].on;
};

export function customExportFields(fields: BoardField[]) {
  return fields.filter((field) => !coreKeys.includes(field.key));
}
export function csvHeaders(fields: BoardField[], record?: RecordConfig) {
  const core = coreHeaders(record);
  const used = new Set(core.map((name) => name.toLowerCase()));
  return [
    ...core,
    ...customExportFields(fields).map((field) => {
      let name = field.name;
      let suffix = 2;
      while (used.has(name.toLowerCase())) name = `${field.name} (${suffix++})`;
      used.add(name.toLowerCase());
      return name;
    }),
  ];
}

export type CsvTask = ViewTask & {
  startDate: string | null;
  revision: number;
  createdByName: string;
  checklist: TaskChecklist;
  fieldValues: Record<string, FieldValue>;
};
export type CsvContext = {
  record?: RecordConfig;
  fields: BoardField[];
  groups: { id: string; name: string }[];
  people: { id: string; name: string }[];
};

export function csvTaskCells(task: CsvTask, context: CsvContext): CsvCell[] {
  const option = (key: string, id: string | null) =>
    context.fields
      .find((field) => field.key === key)
      ?.options.find((option) => option.id === id)?.label ??
    (key === "priority" && id
      ? id.charAt(0) + id.slice(1).toLowerCase()
      : (id ?? ""));
  const person = (id: string) =>
    context.people.find((person) => person.id === id)?.name ?? "Former member";
  const ids = [...task.assigneeIds].sort();
  const core: CsvCell[] = [
    task.id,
    task.name,
    task.description,
    option("status", task.statusId),
    option("priority", task.priority),
    task.startDate,
    task.dueDate,
    context.groups.find((group) => group.id === task.groupId)?.name ?? "",
    JSON.stringify(ids.map(person)),
    JSON.stringify(ids),
    JSON.stringify(task.checklist.map(({ text, done }) => ({ text, done }))),
    task.archivedAt,
    task.revision,
    task.createdByName,
  ];
  return [
    ...core.filter((_, index) => keepCore(context.record, index)),
    ...customExportFields(context.fields).map((field) => {
      const value = task.fieldValues[field.id];
      if (value == null) return "";
      if (field.type === "PEOPLE")
        return JSON.stringify((Array.isArray(value) ? value : []).map(person));
      if (Array.isArray(value))
        return JSON.stringify(
          value.map(
            (id) =>
              field.options.find((option) => option.id === id)?.label ?? id,
          ),
        );
      if (field.options.length)
        return (
          field.options.find((option) => option.id === value)?.label ??
          String(value)
        );
      return value;
    }),
  ];
}

export function csvFilename(boardName: string, calendarDate: string) {
  const name =
    Array.from(boardName.replace(/[<>:"/\\|?*\p{C}]/gu, "-").trim())
      .slice(0, 60)
      .join("") || "board";
  return `yuzu-${name}-${calendarDate}.csv`;
}
