import {
  builtinLabels,
  builtinName,
  lower,
  type BuiltinKey,
  type RecordConfig,
} from "./record-types";
import { z } from "zod";
import {
  createTaskSchema,
  coreKeys,
  dateOnly,
  priorities,
  type BoardField,
} from "./board-contract";
import { recordId } from "./id-contract";

export const MAX_IMPORT_BYTES = 25_000_000;
export const MAX_IMPORT_ROWS = 25_000;
export const MAX_PREVIEW_BYTES = 1_000_000;
export const MAX_PREVIEW_ROWS = 500;
export const importMappingSchema = z
  .array(
    z
      .object({
        column: z.number().int().min(0).max(99),
        target: z.string().min(1).max(100),
      })
      .strict(),
  )
  .min(1)
  .max(100)
  .refine(
    (items) =>
      new Set(items.map((item) => item.target)).size === items.length &&
      new Set(items.map((item) => item.column)).size === items.length,
    "Map each column and destination only once.",
  );
export const importPreviewSchema = z
  .object({
    boardId: recordId,
    csv: z.string().min(1).max(MAX_PREVIEW_BYTES),
    mapping: importMappingSchema,
  })
  .strict();
export const importRowSchema = z
  .object({
    token: z.string().min(1).max(2_000_000),
    allowDuplicate: z.boolean(),
  })
  .strict();
export type ImportMapping = z.infer<typeof importMappingSchema>;
export type ImportContext = {
  /** The board's record names and built-ins; Task defaults when absent. */
  record?: RecordConfig;
  fields: BoardField[];
  groups: { id: string; name: string }[];
  people: { id: string; name: string }[];
};
export type ImportRow = {
  row: number;
  name: string;
  values: { label: string; value: string }[];
  issues: string[];
  duplicate: boolean;
  duplicateReason?: string;
  token?: string;
};
export type ImportPreview = { rows: ImportRow[]; requiresApproval: boolean };
export type ImportResult = {
  outcome: "APPLIED" | "PENDING_APPROVAL" | "SKIPPED";
  taskId?: string | null;
  proposalId?: string;
};
export const importPreviewResultSchema: z.ZodType<ImportPreview> = z.object({
  rows: z
    .array(
      z.object({
        row: z.number().int().min(2),
        name: z.string(),
        values: z.array(z.object({ label: z.string(), value: z.string() })),
        issues: z.array(z.string()),
        duplicate: z.boolean(),
        duplicateReason: z.string().optional(),
        token: z.string().optional(),
      }),
    )
    .max(MAX_IMPORT_ROWS),
  requiresApproval: z.boolean(),
});
export const importResultSchema: z.ZodType<ImportResult> = z.object({
  outcome: z.enum(["APPLIED", "PENDING_APPROVAL", "SKIPPED"]),
  taskId: recordId.nullable().optional(),
  proposalId: recordId.optional(),
});

/** Strict comma-separated CSV, including escaped quotes and multiline cells. */
export function parseImportCsv(
  source: string,
  limits = { maxBytes: MAX_IMPORT_BYTES, maxRows: MAX_IMPORT_ROWS },
) {
  if (new TextEncoder().encode(source).length > limits.maxBytes)
    throw new Error(
      `Choose a CSV file up to ${limits.maxBytes / 1_000_000} MB.`,
    );
  const text = source.replace(/^\uFEFF/u, "");
  if (text.includes("\0"))
    throw new Error("Use a UTF-8 CSV file without binary content.");
  const records: string[][] = [];
  let cells: string[] = [],
    cell = "",
    quoted = false,
    closed = false,
    segmentStart = 0;
  const finishCell = (end: number) => {
    if (!closed) cell += text.slice(segmentStart, end);
    cells.push(cell);
    cell = "";
    closed = false;
    if (cells.length > 100) throw new Error("Use at most 100 columns.");
  };
  const finishRow = (end: number) => {
    finishCell(end);
    if (cells.some((value) => value.trim())) records.push(cells);
    cells = [];
    if (records.length > limits.maxRows + 1)
      throw new Error(
        `Import at most ${limits.maxRows.toLocaleString("en-US")} tasks at a time.`,
      );
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        cell += text.slice(segmentStart, i);
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
        segmentStart = i + 1;
      }
    } else if (char === ",") {
      finishCell(i);
      segmentStart = i + 1;
    } else if (char === "\n" || char === "\r") {
      finishRow(i);
      if (char === "\r" && text[i + 1] === "\n") i++;
      segmentStart = i + 1;
    } else if (char === '"' && cell === "" && i === segmentStart && !closed) {
      quoted = true;
      segmentStart = i + 1;
    } else {
      if (closed || char === '"')
        throw new Error(
          "Check the CSV quotes. Wrap cells containing commas or line breaks in double quotes.",
        );
    }
  }
  if (quoted)
    throw new Error("A quoted CSV cell is missing its closing quote.");
  if (segmentStart < text.length || cell !== "" || cells.length || closed)
    finishRow(text.length);
  if (records.length < 2)
    throw new Error("Include a header row and at least one task.");
  const [headers, ...rows] = records;
  if (
    headers.some((h) =>
      /^(parent[ _-]?(id|task|name)?|subitems?|hierarchy|depth|level)$/i.test(
        h.trim(),
      ),
    )
  )
    throw new Error(
      "Subitems are not supported in CSV imports. Remove hierarchy columns and import tasks only.",
    );
  if (headers.some((header) => !header.trim()))
    throw new Error("Give every CSV column a header.");
  if (rows.some((row) => row.length !== headers.length))
    throw new Error(
      "Every row must have the same number of columns as the header.",
    );
  return { headers, rows };
}

/** Bound server work independently of the size of the selected file. */
export function* importPreviewChunks(csv: ReturnType<typeof parseImportCsv>) {
  const encode = (row: string[]) =>
    row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",") + "\r\n";
  const header = encode(csv.headers),
    encoder = new TextEncoder();
  const headerBytes = encoder.encode(header).length;
  let lines: string[] = [],
    bytes = headerBytes,
    start = 0;
  for (let index = 0; index < csv.rows.length; index++) {
    const line = encode(csv.rows[index]),
      size = encoder.encode(line).length;
    if (headerBytes + size > MAX_PREVIEW_BYTES)
      throw new Error(
        `Row ${index + 2} is too large to preview. Reduce its text or number of mapped fields.`,
      );
    if (
      lines.length &&
      (lines.length >= MAX_PREVIEW_ROWS || bytes + size > MAX_PREVIEW_BYTES)
    ) {
      yield { csv: header + lines.join(""), start, count: lines.length };
      start = index;
      lines = [];
      bytes = headerBytes;
    }
    lines.push(line);
    bytes += size;
  }
  if (lines.length)
    yield { csv: header + lines.join(""), start, count: lines.length };
}

export function importTargets(context: ImportContext) {
  const record = context.record;
  const singular = record?.singular ?? "Task";
  const noun = lower(singular);
  const builtin = (key: BuiltinKey, id: string, aliases: string[]) => {
    if (record && !record.builtins[key].on) return [];
    const name = record ? builtinName(record, key) : builtinLabels[key];
    return [
      { id, name, aliases: [...new Set([name.toLowerCase(), ...aliases])] },
    ];
  };
  return [
    {
      id: "name",
      name: `${singular} title`,
      aliases: [...new Set([noun, "task", "title", "name"])],
    },
    ...builtin("description", "description", ["description"]),
    ...builtin("status", "status", ["status"]),
    ...builtin("priority", "priority", ["priority"]),
    ...builtin("startDate", "start_date", [
      "start date",
      "start_date",
      "start",
    ]),
    ...builtin("dueDate", "due_date", ["due date", "due_date", "target date"]),
    { id: "group", name: "Group", aliases: ["group"] },
    ...builtin("assignees", "assignees", ["assignees", "assignee"]),
    ...builtin("checklist", "checklist", ["checklist"]),
    {
      id: "source_id",
      name: `Original ${noun} ID (duplicate check only)`,
      aliases: [...new Set([`${noun} id`, "task id"])],
    },
    ...context.fields
      .filter((field) => !coreKeys.includes(field.key))
      .map((field) => ({
        id: field.id,
        name: field.name,
        aliases: [field.name.toLowerCase()],
      })),
  ];
}
export function suggestImportMapping(
  headers: string[],
  context: ImportContext,
): ImportMapping {
  const targets = importTargets(context),
    used = new Set<string>();
  return headers.flatMap((header, column) => {
    const matches = targets.filter((target) =>
      target.aliases.includes(header.trim().toLowerCase()),
    );
    if (matches.length !== 1 || used.has(matches[0].id)) return [];
    used.add(matches[0].id);
    return [{ column, target: matches[0].id }];
  });
}
const list = (value: string): string[] => {
  const parsed: unknown = value.startsWith("[")
    ? JSON.parse(value)
    : value.split("|").map((item) => item.trim());
  return z.array(z.string().min(1)).max(50).parse(parsed);
};
function resolve(value: string, choices: { id: string; label: string }[]) {
  const byId = choices.find((choice) => choice.id === value);
  if (byId) return byId.id;
  const matches = choices.filter(
    (choice) => choice.label.toLowerCase() === value.toLowerCase(),
  );
  if (matches.length !== 1)
    throw new Error(
      `“${value.slice(0, 80)}” does not match one saved option. Use its exact label or ID.`,
    );
  return matches[0].id;
}
export function mapImportRow(
  cells: string[],
  mapping: ImportMapping,
  context: ImportContext,
  boardId: string,
  makeId: () => string,
) {
  const input: Record<string, unknown> = {
    boardId,
    createKey: makeId(),
    fieldValues: {},
  };
  const issues: string[] = [];
  let sourceId: string | undefined;
  for (const { column, target } of mapping) {
    const value = cells[column]?.trim() ?? "";
    if (!value) continue;
    try {
      const choices = (items: { id: string; name: string }[]) =>
        items.map((item) => ({ id: item.id, label: item.name }));
      if (target === "name" || target === "description")
        input[target] = target === "description" ? cells[column] : value;
      else if (target === "source_id") sourceId = recordId.parse(value);
      else if (target === "status")
        input.statusId = resolve(
          value,
          context.fields.find((field) => field.key === "status")?.options ?? [],
        );
      else if (target === "priority") {
        const saved =
          context.fields.find((field) => field.key === "priority")?.options ??
          [];
        input.priority = z.enum(priorities).parse(
          resolve(
            value,
            saved.length
              ? saved
              : priorities.map((id) => ({
                  id,
                  label: id[0] + id.slice(1).toLowerCase(),
                })),
          ),
        );
      } else if (target === "due_date") input.dueDate = dateOnly.parse(value);
      else if (target === "start_date") input.startDate = dateOnly.parse(value);
      else if (target === "group")
        input.groupId = resolve(value, choices(context.groups));
      else if (target === "assignees")
        input.assigneeIds = list(value).map((item) =>
          resolve(item, choices(context.people)),
        );
      else if (target === "checklist") {
        const items: unknown = value.startsWith("[")
          ? JSON.parse(value)
          : value
              .split("|")
              .map((text) => ({ text: text.trim(), done: false }));
        input.checklist = z
          .array(
            z.object({
              text: z.string().trim().min(1).max(300),
              done: z.boolean(),
            }),
          )
          .max(100)
          .parse(items)
          .map((item) => ({ ...item, id: makeId() }));
      } else {
        const field = context.fields.find(
          (field) => field.id === target && !coreKeys.includes(field.key),
        );
        if (!field) throw new Error("This field is no longer available.");
        let converted: unknown = ["TEXT", "LONG_TEXT"].includes(field.type)
          ? cells[column]
          : value;
        if (field.type === "NUMBER") {
          if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value))
            throw new Error(
              "Use a number without currency symbols or separators.",
            );
          converted = z.number().finite().parse(Number(value));
        } else if (field.type === "CHECKBOX") {
          if (!/^(true|false|yes|no|1|0)$/iu.test(value))
            throw new Error("Use true/false, yes/no, or 1/0.");
          converted = /^(true|yes|1)$/iu.test(value);
        } else if (["SINGLE_SELECT", "STATUS"].includes(field.type))
          converted = resolve(value, field.options);
        else if (["MULTI_SELECT", "TAGS"].includes(field.type))
          converted = list(value).map((item) => resolve(item, field.options));
        else if (field.type === "PEOPLE")
          converted = list(value).map((item) =>
            resolve(item, choices(context.people)),
          );
        else if (field.type === "DATE") converted = dateOnly.parse(value);
        (input.fieldValues as Record<string, unknown>)[field.id] = converted;
      }
    } catch (error) {
      const label =
        importTargets(context).find((item) => item.id === target)?.name ??
        target;
      issues.push(
        `${label}: ${error instanceof z.ZodError ? "Check the value and format." : error instanceof Error ? error.message : "Check this value."}`,
      );
    }
  }
  if (
    typeof input.startDate === "string" &&
    typeof input.dueDate === "string" &&
    input.startDate > input.dueDate
  )
    issues.push("Start date: Must be on or before the due date.");
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success)
    issues.push(
      ...parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  return {
    input: parsed.success ? parsed.data : null,
    issues,
    name: String(input.name ?? "Untitled row"),
    sourceId,
  };
}
