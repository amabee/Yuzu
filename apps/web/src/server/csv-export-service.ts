import { getDatabase, createRecordId } from "@yuzu/database";
import { access, eligiblePeople } from "./board-service";
import { audit } from "./audit";
import { requireIdentity, isAdministrator } from "./team-access";
import { SetupError } from "./setup/security";
import {
  checklistSchema,
  fieldOptions,
  type BoardField,
  type FieldValue,
} from "@/lib/board-contract";
import { matchesBoardView, compareBoardView } from "@/lib/board-view";
import {
  exportCsvSchema,
  MAX_CSV_TASKS,
  MAX_CSV_BYTES,
  csvHeaders,
  csvLine,
  csvTaskCells,
  csvFilename,
  type CsvTask,
} from "@/lib/csv-export";

const tooLarge = (message: string) =>
  new SetupError(413, "EXPORT_TOO_LARGE", message);
export async function exportBoardCsv(
  input: unknown,
  headers: Headers,
  signal?: AbortSignal,
) {
  const { user } = await requireIdentity(headers);
  const result = await exportBoardCsvForActor(input, user.id, signal);
  const current = await requireIdentity(headers);
  await getDatabase().$transaction((tx) =>
    access(tx, current.user.id, exportCsvSchema.parse(input).boardId),
  );
  return result;
}
export async function exportBoardCsvForActor(
  input: unknown,
  actorId: string,
  signal?: AbortSignal,
) {
  const request = exportCsvSchema.parse(input);
  const db = getDatabase();
  const user = await db.user.findUnique({ where: { id: actorId } });
  const settings = await db.installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (!user || settings?.setupState !== "READY")
    throw new SetupError(
      403,
      "FORBIDDEN",
      "Your account is no longer available.",
    );
  if (settings.maintenanceMode && !isAdministrator(user.role))
    throw new SetupError(
      503,
      "MAINTENANCE",
      "Exports are paused during maintenance.",
    );
  const config = request.scope === "VIEW" ? request.config : null;
  let result;
  try {
    result = await getDatabase().$transaction(
      async (tx) => {
        const { board } = await access(tx, user.id, request.boardId);
        const calendarDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: settings.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        const fields: BoardField[] = board.columns.map((field) => ({
          ...field,
          version: "",
          options: fieldOptions(field.config),
        }));
        if (
          config?.groupId &&
          !board.groups.some((group) => group.id === config.groupId)
        )
          throw new SetupError(
            422,
            "EXPORT_GROUP",
            "This view uses a removed group. Choose a current group before exporting.",
          );
        if (
          config?.statusId &&
          config.statusId !== "__none__" &&
          !fields
            .find((field) => field.key === "status")
            ?.options.some((option) => option.id === config.statusId)
        )
          throw new SetupError(
            422,
            "EXPORT_STATUS",
            "This view uses a removed status. Choose a current status before exporting.",
          );
        const context = {
          fields,
          groups: board.groups,
          people: await eligiblePeople(tx, board),
        };
        const prefix = "\ufeff" + csvLine(csvHeaders(fields));
        let bytes = Buffer.byteLength(prefix);
        if (bytes > MAX_CSV_BYTES)
          throw tooLarge(
            "This board has too many columns for a single export.",
          );
        const rows: {
          task: Pick<CsvTask, "name" | "dueDate">;
          line: string;
        }[] = [];
        let cursor: string | undefined;
        let scanned = 0;
        while (true) {
          if (signal?.aborted)
            throw new SetupError(
              400,
              "EXPORT_CANCELLED",
              "The export was cancelled.",
            );
          const batch = await tx.task.findMany({
            where: {
              boardId: board.id,
              archivedAt: config
                ? config.archived
                  ? { not: null }
                  : null
                : request.scope === "BOARD" && request.includeArchived
                  ? undefined
                  : null,
              ...(config?.groupId ? { groupId: config.groupId } : {}),
              ...(config?.statusId
                ? {
                    statusId:
                      config.statusId === "__none__" ? null : config.statusId,
                  }
                : {}),
              ...(config?.priority && config.priority !== "all"
                ? { priority: config.priority }
                : {}),
              ...(config?.assignee === "me"
                ? { assignees: { some: { userId: user.id } } }
                : config?.assignee === "unassigned"
                  ? { assignees: { none: {} } }
                  : {}),
            },
            select: {
              id: true,
              name: true,
              description: true,
              statusId: true,
              priority: true,
              startDate: true,
              dueDate: true,
              groupId: true,
              archivedAt: true,
              revision: true,
              checklist: true,
              createdBy: { select: { name: true } },
              assignees: { select: { userId: true } },
              values: {
                where: { fieldId: { in: fields.map((field) => field.id) } },
                select: {
                  fieldId: true,
                  textValue: true,
                  numberValue: true,
                  booleanValue: true,
                  dateValue: true,
                  choices: true,
                  people: { select: { userId: true } },
                },
              },
            },
            take: 100,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          });
          if (!batch.length) break;
          scanned += batch.length;
          if (scanned > 50_000)
            throw tooLarge(
              "Too many tasks to scan. Narrow the status, group, assignee, or priority filter and try again.",
            );
          for (const record of batch) {
            const task: CsvTask = {
              ...record,
              archivedAt: record.archivedAt?.toISOString() ?? null,
              startDate: record.startDate?.toISOString().slice(0, 10) ?? null,
              dueDate: record.dueDate?.toISOString().slice(0, 10) ?? null,
              createdByName: record.createdBy.name,
              assigneeIds: record.assignees.map((person) => person.userId),
              checklist: checklistSchema.parse(record.checklist),
              fieldValues: Object.fromEntries(
                record.values.map((value) => {
                  const field = fields.find(
                    (field) => field.id === value.fieldId,
                  )!;
                  const parsed: FieldValue =
                    field.type === "PEOPLE"
                      ? value.people.map((person) => person.userId)
                      : ["MULTI_SELECT", "TAGS"].includes(field.type)
                        ? value.choices
                        : (value.textValue ??
                          value.numberValue ??
                          value.booleanValue ??
                          value.dateValue?.toISOString().slice(0, 10) ??
                          null);
                  return [value.fieldId, parsed];
                }),
              ),
            };
            if (
              config &&
              !matchesBoardView(task, config, user.id, calendarDate)
            )
              continue;
            const line = csvLine(csvTaskCells(task, context));
            bytes += Buffer.byteLength(line);
            if (rows.length >= MAX_CSV_TASKS || bytes > MAX_CSV_BYTES)
              throw tooLarge(
                "Exports support up to 10,000 tasks or 10 MB. Narrow your filters and try again.",
              );
            rows.push({
              task: { name: task.name, dueDate: task.dueDate },
              line,
            });
          }
          cursor = batch.at(-1)!.id;
          if (batch.length < 100) break;
        }
        if (config)
          rows.sort((a, b) => compareBoardView(a.task, b.task, config.sort));
        return {
          csv: prefix + rows.map((row) => row.line).join(""),
          rowCount: rows.length,
          filename: csvFilename(board.name, calendarDate),
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000, maxWait: 5_000 },
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "P2028"
    )
      throw tooLarge(
        "The export could not finish in time. Try a smaller selection.",
      );
    throw error;
  }
  // Recheck current access after the snapshot finishes, before any bytes leave the server.

  await getDatabase().$transaction(async (tx) => {
    const { board } = await access(tx, actorId, request.boardId);
    await audit(tx, {
      actorId,
      action: "CSV_EXPORTED",
      subject: board.name,
      subjectId: board.id,
      workspaceId: board.workspaceId,
      details: `${result.rowCount} ${result.rowCount === 1 ? "row" : "rows"}`,
    });
    await tx.boardEvent.create({
      data: {
        id: createRecordId(),
        boardId: request.boardId,
        actorId: actorId,
        action: "Exported board CSV",
        after: { scope: request.scope, rowCount: result.rowCount },
      },
    });
  });
  return result;
}
