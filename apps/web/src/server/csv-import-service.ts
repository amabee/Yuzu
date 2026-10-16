import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createRecordId, getDatabase } from "@yuzu/database";
import {
  access,
  eligiblePeople,
  createTask,
  validateCore,
  validateValues,
} from "./board-service";
import { requireIdentity } from "./team-access";
import { SetupError } from "./setup/security";
import { readApprovalPolicy } from "./approval-policy";
import { createTaskSchema, fieldOptions } from "@/lib/board-contract";
import {
  importPreviewSchema,
  importRowSchema,
  importTargets,
  mapImportRow,
  parseImportCsv,
  MAX_PREVIEW_BYTES,
  MAX_PREVIEW_ROWS,
  type ImportPreview,
  type ImportResult,
} from "@/lib/csv-import";
import { notifyBoardMutation } from "./realtime";

const ticketSchema = z
  .object({
    version: z.literal(1),
    actorId: z.string(),
    expiresAt: z.number(),
    input: createTaskSchema,
    sourceId: z.string().uuid().optional(),
  })
  .strict();
function signature(payload: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new SetupError(
      503,
      "CONFIGURATION_REQUIRED",
      "Configure the authentication secret before importing.",
    );
  return createHmac("sha256", secret)
    .update(`yuzu-csv-import-v1:${payload}`)
    .digest();
}
function signTicket(ticket: z.infer<typeof ticketSchema>) {
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}
function readTicket(token: string) {
  const parts = token.split(".");
  const expected = signature(parts[0]);
  const supplied = Buffer.from(parts[1] ?? "", "base64url");
  if (
    parts.length !== 2 ||
    supplied.length !== expected.length ||
    !timingSafeEqual(expected, supplied)
  )
    throw new SetupError(
      422,
      "IMPORT_PREVIEW_INVALID",
      "This preview is invalid. Preview the CSV again.",
    );
  let parsed;
  try {
    parsed = ticketSchema.parse(
      JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
    );
  } catch {
    throw new SetupError(
      422,
      "IMPORT_PREVIEW_INVALID",
      "This preview is invalid. Preview the CSV again.",
    );
  }
  if (parsed.expiresAt < Date.now())
    throw new SetupError(
      409,
      "IMPORT_PREVIEW_EXPIRED",
      "This preview expired. Preview the CSV again before importing.",
    );
  return parsed;
}

export async function previewCsvImport(
  input: unknown,
  headers: Headers,
): Promise<ImportPreview> {
  const body = importPreviewSchema.parse(input);
  const { user } = await requireIdentity(headers);
  let csv;
  try {
    csv = parseImportCsv(body.csv, {
      maxBytes: MAX_PREVIEW_BYTES,
      maxRows: MAX_PREVIEW_ROWS,
    });
  } catch (error) {
    throw new SetupError(422, "INVALID_CSV", (error as Error).message);
  }
  return getDatabase().$transaction(
    async (tx) => {
      const context = await access(tx, user.id, body.boardId, true);
      const people = await eligiblePeople(tx, context.board.workspaceId);
      const eligible = new Set(people.map((person) => person.id));
      const model = {
        fields: context.board.columns.map((field) => ({
          ...field,
          version: "",
          options: fieldOptions(field.config),
        })),
        groups: context.board.groups,
        people,
      };
      const targets = new Set(importTargets(model).map((item) => item.id));
      if (
        !body.mapping.some((item) => item.target === "name") ||
        body.mapping.some(
          (item) =>
            !targets.has(item.target) || item.column >= csv.headers.length,
        )
      )
        throw new SetupError(
          422,
          "INVALID_MAPPING",
          "Map a task title and choose current board fields for each column.",
        );
      const mapped = csv.rows.map((cells) =>
        mapImportRow(cells, body.mapping, model, body.boardId, createRecordId),
      );
      const existing = await tx.task.findMany({
        where: {
          boardId: body.boardId,
          OR: [
            {
              name: { in: mapped.map((row) => row.name), mode: "insensitive" },
            },
            {
              id: {
                in: mapped.flatMap((row) =>
                  row.sourceId ? [row.sourceId] : [],
                ),
              },
            },
          ],
        },
        select: { id: true, name: true },
        take: 10_001,
      });
      if (existing.length > 10_000)
        throw new SetupError(
          422,
          "IMPORT_DUPLICATE_LIMIT",
          "Too many matching tasks to preview. Import a smaller CSV with more specific titles.",
        );
      const names = new Set(existing.map((task) => task.name.toLowerCase()));
      const proposed = await tx.$queryRaw<{ name: string }[]>`
        SELECT DISTINCT lower("changes"->>'name') AS "name" FROM "BoardProposal"
        WHERE "boardId" = ${body.boardId} AND "operation" = 'CREATE' AND "status" = 'PENDING'
        AND lower("changes"->>'name') IN (
          SELECT lower(value) FROM jsonb_array_elements_text(${JSON.stringify(mapped.map((row) => row.name))}::jsonb)
        )
      `;
      for (const proposal of proposed) names.add(proposal.name);
      const ids = new Set(existing.map((task) => task.id));
      const policy = await readApprovalPolicy(tx, context.board);
      const rows = mapped.map((row, index) => {
        if (row.input && !row.issues.length) {
          try {
            validateCore(row.input, context.board, eligible);
            validateValues(row.input.fieldValues, context.board, eligible);
          } catch (error) {
            row.issues.push(
              error instanceof SetupError
                ? error.message
                : error instanceof z.ZodError
                  ? (error.issues[0]?.message ?? "Check the field values.")
                  : "Check the field values.",
            );
          }
        }
        const duplicate =
          names.has(row.name.toLowerCase()) ||
          Boolean(row.sourceId && ids.has(row.sourceId));
        let token: string | undefined;
        if (row.input && !row.issues.length) {
          token = signTicket({
            version: 1,
            actorId: user.id,
            expiresAt: Date.now() + 24 * 60 * 60_000,
            input: row.input,
            ...(row.sourceId ? { sourceId: row.sourceId } : {}),
          });
          if (token.length > 2_000_000) {
            token = undefined;
            row.issues.push(
              "This row contains too much data. Split it into smaller tasks.",
            );
          }
        }
        if (row.input && !row.issues.length) names.add(row.name.toLowerCase());
        return {
          row: index + 2,
          name: row.name,
          values: body.mapping
            .filter((item) => item.target !== "name")
            .map((item) => ({
              label: importTargets(model).find(
                (target) => target.id === item.target,
              )!.name,
              value:
                csv.rows[index][item.column].length > 1000
                  ? `${csv.rows[index][item.column].slice(0, 1000)}…`
                  : csv.rows[index][item.column],
            })),
          issues: row.issues,
          duplicate,
          ...(duplicate
            ? {
                duplicateReason:
                  "Matches an existing task (including archived tasks), pending creation request, or earlier CSV row.",
              }
            : {}),
          ...(token ? { token } : {}),
        };
      });
      return {
        rows,
        requiresApproval: policy.enabled && policy.requireCreation,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 15_000 },
  );
}

export async function importCsvRow(
  input: unknown,
  headers: Headers,
): Promise<ImportResult> {
  const body = importRowSchema.parse(input);
  const { user } = await requireIdentity(headers);
  const ticket = readTicket(body.token);
  if (ticket.actorId !== user.id)
    throw new SetupError(
      403,
      "IMPORT_OWNER",
      "Preview the CSV with your own account before importing.",
    );
  try {
    // The ordinary task transaction rechecks permissions, options, maintenance and approval policy.
    // Its creation key also makes retries safe after a lost response.
    const result = await createTask(ticket.input, headers, {
      skipDuplicate: !body.allowDuplicate,
      sourceId: ticket.sourceId,
    });
    await notifyBoardMutation(ticket.input, result);
    return result;
  } catch (error) {
    if (error instanceof SetupError && error.code === "IMPORT_DUPLICATE")
      return { outcome: "SKIPPED" };
    throw error;
  }
}
