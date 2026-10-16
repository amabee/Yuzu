"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, Check, FileUp, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TransferNoticeHandler } from "@/components/ui/yuzu-toast";
import type { BoardState } from "@/lib/board-contract";
import { apiRequest, ApiError } from "@/lib/api-client";
import {
  importTargets,
  importPreviewResultSchema,
  importResultSchema,
  parseImportCsv,
  suggestImportMapping,
  MAX_IMPORT_BYTES,
  type ImportMapping,
  type ImportPreview,
  type ImportResult,
  type ImportRow,
} from "@/lib/csv-import";

type RowResult = {
  row: number;
  outcome: ImportResult["outcome"] | "FAILED";
  message?: string;
};
export function ImportCsv({
  state,
  onNotice,
  onChanged,
}: {
  state: BoardState;
  onNotice: TransferNoticeHandler;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [parsed, setParsed] = useState<ReturnType<
    typeof parseImportCsv
  > | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<RowResult[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const fileRead = useRef(0);
  const targets = importTargets(state);
  const previewMutation = useMutation({
    retry: false,
    mutationFn: async () =>
      importPreviewResultSchema.parse(
        (
          await apiRequest<ImportPreview>("/api/v1/boards/import/preview", {
            method: "POST",
            json: { boardId: state.boardId, csv, mapping },
          })
        ).data,
      ),
    onSuccess: (data) => {
      setPreview(data);
      setSelected(
        new Set(
          data.rows
            .filter((row) => row.token && !row.duplicate)
            .map((row) => row.row),
        ),
      );
      setResults([]);
    },
    onError: (failure) => {
      setError(failure.message);
      onNotice({
        id: crypto.randomUUID(),
        kind: "error",
        title: "Preview failed",
        message: failure.message,
      });
    },
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ rows, id }: { rows: ImportRow[]; id: string }) => {
      const completed: RowResult[] = [];
      setProgress({ done: 0, total: rows.length });
      const announce = () =>
        onNotice({
          id,
          kind: "loading",
          title: "Importing tasks",
          message: `${completed.length} of ${rows.length} rows processed. You can close this panel.`,
          icon: "upload",
          dismissible: false,
          progress: (completed.length / rows.length) * 100,
        });
      announce();
      for (const row of rows) {
        try {
          const { data } = await apiRequest<ImportResult>(
            "/api/v1/boards/import/row",
            {
              method: "POST",
              json: { token: row.token, allowDuplicate: row.duplicate },
            },
          );
          const result = importResultSchema.parse(data);
          completed.push({ row: row.row, outcome: result.outcome });
          if (result.outcome !== "SKIPPED") onChanged();
        } catch (failure) {
          const message =
            failure instanceof Error
              ? failure.message
              : "This row could not finish.";
          completed.push({ row: row.row, outcome: "FAILED", message });
          // Stop flooding an unavailable service or a board the importer can no longer access.
          if (
            failure instanceof TypeError ||
            (failure instanceof ApiError &&
              [401, 403, 404, 429, 503].includes(failure.status))
          ) {
            completed.push(
              ...rows.slice(completed.length).map((item) => ({
                row: item.row,
                outcome: "FAILED" as const,
                message: `Not attempted: ${message}`,
              })),
            );
            break;
          }
        }
        setResults((previous) => [
          ...previous.filter(
            (item) => !completed.some((done) => done.row === item.row),
          ),
          ...completed,
        ]);
        setProgress({ done: completed.length, total: rows.length });
        announce();
      }
      return completed;
    },
    onSuccess: (completed, { id }) => {
      setResults((previous) => [
        ...previous.filter(
          (item) => !completed.some((done) => done.row === item.row),
        ),
        ...completed,
      ]);
      const failed = completed.filter((row) => row.outcome === "FAILED").length;
      const created = completed.filter(
        (row) => row.outcome === "APPLIED",
      ).length;
      const approvals = completed.filter(
        (row) => row.outcome === "PENDING_APPROVAL",
      ).length;
      onNotice({
        id,
        kind: failed ? "warning" : "success",
        title: failed ? "Import needs attention" : "Import complete",
        message: `${created} created, ${approvals} awaiting approval, ${completed.filter((row) => row.outcome === "SKIPPED").length} skipped${failed ? `, ${failed} failed. Reopen Import CSV to retry.` : "."}`,
        progress: 100,
      });
      onChanged();
    },
    onError: (failure, { id }) =>
      onNotice({
        id,
        kind: "error",
        title: "Import interrupted",
        message: failure.message,
      }),
  });
  const busy = reading || previewMutation.isPending || mutation.isPending;
  const finished = !mutation.isPending && results.length > 0;
  const step =
    results.length || mutation.isPending ? 3 : preview ? 2 : parsed ? 1 : 0;
  async function readFile(file?: File) {
    const generation = ++fileRead.current;
    setError("");
    setPreview(null);
    setParsed(null);
    setCsv("");
    setResults([]);
    setMapping([]);
    setFileName(file?.name ?? "");
    if (!file) return;
    setReading(true);
    try {
      if (!/\.csv$/iu.test(file.name))
        throw new Error("Choose a .csv file saved as UTF-8.");
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error("Choose a CSV file up to 1 MB.");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      const data = parseImportCsv(content);
      if (generation !== fileRead.current) return;
      setCsv(content);
      setParsed(data);
      setMapping(suggestImportMapping(data.headers, state));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "This CSV could not be read.",
      );
    } finally {
      if (generation === fileRead.current) setReading(false);
    }
  }
  function start(rows: ImportRow[]) {
    if (!mutation.isPending && rows.length)
      mutation.mutate({ rows, id: crypto.randomUUID() });
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileUp size={14} />
        {mutation.isPending ? "Importing…" : "Import CSV"}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="export-sheet-panel w-full gap-6 overflow-y-auto p-6 sm:max-w-md">
          <div className="flex items-start gap-3 pr-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Table2 size={20} />
            </span>
            <div>
              <SheetTitle>Bring your tasks into Yuzu</SheetTitle>
              <SheetDescription className="mt-1">
                Match your columns, review each row, then import into this
                board.
              </SheetDescription>
            </div>
          </div>
          <ol
            aria-label="Import steps"
            className="grid grid-cols-4 gap-2 text-xs"
          >
            {["Upload", "Map", "Preview", "Results"].map((label, index) => (
              <li
                key={label}
                aria-current={index === step ? "step" : undefined}
                className={`border-t-2 pt-2 ${index <= step ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}
              >
                <span className="mr-1.5">
                  {index < step ? (
                    <Check className="inline size-3" />
                  ) : (
                    index + 1
                  )}
                </span>
                {label}
              </li>
            ))}
          </ol>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {!preview && (
            <fieldset disabled={busy} className="grid min-w-0 gap-6">
              <label className="grid gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm">
                <span className="font-medium">Choose your CSV</span>
                <input
                  aria-label="CSV file"
                  type="file"
                  accept=".csv,text/csv"
                  className="min-w-0 w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:font-medium file:text-secondary-foreground"
                  onChange={(event) => void readFile(event.target.files?.[0])}
                />
                <span className="text-xs leading-relaxed text-muted-foreground">
                  UTF-8, comma-separated. Up to 1 MB, 500 tasks, and 100
                  columns. A header row is required.
                </span>
              </label>
              {parsed && (
                <>
                  <div>
                    <h3 className="text-sm font-semibold">
                      Match your columns
                    </h3>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {fileName} · {parsed.rows.length} rows. Unmapped columns
                      are ignored.
                    </p>
                  </div>
                  <div className="grid gap-4">
                    {parsed.headers.map((header, column) => (
                      <div key={column} className="grid min-w-0 gap-2">
                        <div className="flex min-w-0 items-baseline justify-between gap-2">
                          <label
                            id={`import-column-${column}`}
                            className="truncate text-sm font-medium"
                          >
                            {header}
                          </label>
                          <span
                            className="max-w-[50%] truncate text-xs text-muted-foreground"
                            title={parsed.rows[0][column]}
                          >
                            e.g. {parsed.rows[0][column] || "(empty)"}
                          </span>
                        </div>
                        <Select
                          value={
                            mapping.find((item) => item.column === column)
                              ?.target ?? "__skip__"
                          }
                          onValueChange={(target) => {
                            setMapping((previous) => [
                              ...previous.filter(
                                (item) => item.column !== column,
                              ),
                              ...(target === "__skip__"
                                ? []
                                : [{ column, target }]),
                            ]);
                            setError("");
                          }}
                        >
                          <SelectTrigger
                            aria-labelledby={`import-column-${column}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__skip__">
                              Do not import
                            </SelectItem>
                            {targets.map((target) => (
                              <SelectItem
                                key={target.id}
                                value={target.id}
                                disabled={mapping.some(
                                  (item) =>
                                    item.target === target.id &&
                                    item.column !== column,
                                )}
                              >
                                {target.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                    Dates use YYYY-MM-DD. Use saved labels or IDs for statuses,
                    groups, and people. Separate multiple values with |, or use
                    a JSON array. Checklist cells accept steps separated by | or
                    JSON objects with text and done. Existing tasks are never
                    overwritten.
                  </div>
                  <Button
                    disabled={
                      !mapping.some((item) => item.target === "name") || busy
                    }
                    onClick={() => {
                      setError("");
                      previewMutation.mutate();
                    }}
                  >
                    {previewMutation.isPending
                      ? "Checking rows…"
                      : "Preview tasks"}
                  </Button>
                </>
              )}
            </fieldset>
          )}
          {preview && (
            <>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {finished ? "Your import results" : "Review before importing"}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {preview.rows.length} rows ·{" "}
                  {preview.rows.filter((row) => row.issues.length).length}{" "}
                  invalid · {preview.rows.filter((row) => row.duplicate).length}{" "}
                  possible duplicates
                </p>
                {preview.requiresApproval && (
                  <p className="rounded-lg bg-primary/10 p-3 text-xs text-foreground">
                    This board requires creation approval. Imported tasks will
                    wait in the approval queue.
                  </p>
                )}
                {!finished && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Possible duplicates start unchecked. Select one to create
                    another task. Invalid rows must be corrected in the CSV and
                    previewed again.
                  </p>
                )}
              </div>
              {finished && (
                <div
                  role="status"
                  className="grid grid-cols-2 gap-3 rounded-lg border border-border p-4 text-sm"
                >
                  {[
                    [
                      "Created",
                      results.filter((row) => row.outcome === "APPLIED").length,
                    ],
                    [
                      "Awaiting approval",
                      results.filter(
                        (row) => row.outcome === "PENDING_APPROVAL",
                      ).length,
                    ],
                    [
                      "Skipped",
                      preview.rows.filter(
                        (row) => !selected.has(row.row) && !row.issues.length,
                      ).length +
                        results.filter((row) => row.outcome === "SKIPPED")
                          .length,
                    ],
                    [
                      "Failed",
                      results.filter((row) => row.outcome === "FAILED").length,
                    ],
                  ].map(([label, count]) => (
                    <p key={label}>
                      <strong className="mr-2 text-lg">{count}</strong>
                      <span className="text-muted-foreground">{label}</span>
                    </p>
                  ))}
                </div>
              )}
              <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {preview.rows.map((row) => {
                  const result = results.find((item) => item.row === row.row);
                  const status =
                    result?.outcome === "APPLIED"
                      ? "Created"
                      : result?.outcome === "PENDING_APPROVAL"
                        ? "Awaiting approval"
                        : result?.outcome === "SKIPPED"
                          ? "Skipped: a matching task exists"
                          : result?.outcome === "FAILED"
                            ? result.message
                            : row.issues.length
                              ? "Invalid"
                              : finished
                                ? "Skipped"
                                : row.duplicate
                                  ? "Possible duplicate"
                                  : "Ready";
                  return (
                    <label key={row.row} className="flex items-start gap-3 p-3">
                      <input
                        type="checkbox"
                        aria-label={`Import row ${row.row}`}
                        className="mt-1 accent-primary"
                        checked={selected.has(row.row)}
                        disabled={busy || finished || !row.token}
                        onChange={(event) =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(row.row);
                            else next.delete(row.row);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium">
                          {row.name}
                        </span>
                        <span
                          className={`mt-1 block text-xs ${row.issues.length || result?.outcome === "FAILED" ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          Row {row.row} · {status}
                        </span>
                        {row.values.some((value) => value.value.trim()) && (
                          <span className="mt-2 block space-y-1 text-xs text-muted-foreground">
                            {row.values
                              .filter((value) => value.value.trim())
                              .map((value, index) => (
                                <span key={index} className="block break-words">
                                  <span className="font-medium">
                                    {value.label}:
                                  </span>{" "}
                                  {value.value.length > 160
                                    ? `${value.value.slice(0, 160)}…`
                                    : value.value}
                                </span>
                              ))}
                          </span>
                        )}
                        {row.issues.map((issue, index) => (
                          <span
                            key={index}
                            className="mt-1 block break-words text-xs text-destructive"
                          >
                            {issue}
                          </span>
                        ))}
                        {row.duplicate && !result && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {row.duplicateReason}
                          </span>
                        )}
                      </span>
                      {row.issues.length > 0 && (
                        <AlertCircle className="size-4 shrink-0 text-destructive" />
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="grid gap-3 pb-2">
                {mutation.isPending ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Importing… {progress.done} of {progress.total} rows
                    processed. Closing this panel keeps the import running.
                  </p>
                ) : finished ? (
                  <>
                    {results.some((row) => row.outcome === "FAILED") && (
                      <Button
                        onClick={() =>
                          start(
                            preview.rows.filter((row) =>
                              results.some(
                                (result) =>
                                  result.row === row.row &&
                                  result.outcome === "FAILED",
                              ),
                            ),
                          )
                        }
                      >
                        Retry failed rows
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPreview(null);
                        setResults([]);
                        setParsed(null);
                        setCsv("");
                        setMapping([]);
                        setFileName("");
                        setError("");
                      }}
                    >
                      Import another CSV
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      disabled={selected.size === 0 || busy}
                      onClick={() => {
                        setResults([]);
                        start(
                          preview.rows.filter(
                            (row) => selected.has(row.row) && row.token,
                          ),
                        );
                      }}
                    >
                      Import {selected.size}{" "}
                      {selected.size === 1 ? "task" : "tasks"}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setPreview(null);
                        setError("");
                      }}
                    >
                      Back to mapping
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
