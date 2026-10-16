"use client";

import { useMemo, useRef, useState } from "react";
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
import { apiRequest } from "@/lib/api-client";
import {
  importTargets,
  importPreviewResultSchema,
  importPreviewChunks,
  parseImportCsv,
  suggestImportMapping,
  MAX_IMPORT_BYTES,
  type ImportMapping,
  type ImportPreview,
  type ImportRow,
} from "@/lib/csv-import";

import { useCsvTransfers } from "@/components/transfers/csv-transfer-runtime";

export function ImportCsv({
  state,
  onNotice,
  onChanged,
}: {
  state: BoardState;
  onNotice: TransferNoticeHandler;
  onChanged: () => void;
}) {
  const { startImport } = useCsvTransfers();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ReturnType<
    typeof parseImportCsv
  > | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previewProgress, setPreviewProgress] = useState({ done: 0, total: 0 });
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const fileRead = useRef(0);
  const targets = importTargets(state);
  const previewMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!parsed) throw new Error("Choose a CSV first.");
      const rows: ImportRow[] = [],
        seen = new Set<string>();
      let requiresApproval = false;
      setPreviewProgress({ done: 0, total: parsed.rows.length });
      for (const chunk of importPreviewChunks(parsed)) {
        const data = importPreviewResultSchema.parse(
          (
            await apiRequest<ImportPreview>("/api/v1/boards/import/preview", {
              method: "POST",
              json: { boardId: state.boardId, csv: chunk.csv, mapping },
            })
          ).data,
        );
        requiresApproval ||= data.requiresApproval;
        for (const source of data.rows) {
          const row = { ...source, row: source.row + chunk.start };
          if (seen.has(row.name.toLowerCase())) {
            row.duplicate = true;
            row.duplicateReason = "Matches an earlier CSV row.";
          }
          if (row.token) seen.add(row.name.toLowerCase());
          rows.push(row);
        }
        setPreviewProgress({
          done: chunk.start + chunk.count,
          total: parsed.rows.length,
        });
      }
      return { rows, requiresApproval };
    },
    onSuccess: (data) => {
      setPreview(data);
      setPage(0);
      setSelected(
        new Set(
          data.rows
            .filter((row) => row.token && !row.duplicate)
            .map((row) => row.row),
        ),
      );
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
    mutationFn: ({ rows }: { rows: ImportRow[]; id: string }) =>
      startImport(state.boardId, fileName || "CSV import", rows),
    onSuccess: () => {
      setOpen(false);
      setPreview(null);
      setParsed(null);
      onNotice({
        id: crypto.randomUUID(),
        kind: "info",
        title: "Import saved",
        message:
          "Follow the lemon for upload and processing progress. You can navigate or refresh.",
      });
      onChanged();
    },
    onError: (failure) =>
      onNotice({
        id: crypto.randomUUID(),
        kind: "error",
        title: "Import could not start",
        message: failure.message,
      }),
  });
  const busy = reading || previewMutation.isPending || mutation.isPending;
  const previewStats = useMemo(
    () => ({
      invalid: preview?.rows.filter((row) => row.issues.length).length ?? 0,
      duplicates: preview?.rows.filter((row) => row.duplicate).length ?? 0,
    }),
    [preview],
  );
  const pageCount = Math.max(1, Math.ceil((preview?.rows.length ?? 0) / 100));
  const step = mutation.isPending ? 3 : preview ? 2 : parsed ? 1 : 0;
  async function readFile(file?: File) {
    const generation = ++fileRead.current;
    setError("");
    setPreview(null);
    setParsed(null);

    setMapping([]);
    setFileName(file?.name ?? "");
    if (!file) return;
    setReading(true);
    try {
      if (!/\.csv$/iu.test(file.name))
        throw new Error("Choose a .csv file saved as UTF-8.");
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error("Choose a CSV file up to 25 MB.");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      const data = parseImportCsv(content);
      if (generation !== fileRead.current) return;
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
                  UTF-8, comma-separated. Up to 25 MB, 25,000 tasks, and 100
                  columns. A header row is required.
                </span>
              </label>
              {reading && (
                <p role="status" className="text-sm text-muted-foreground">
                  Reading {fileName}…
                </p>
              )}
              {previewMutation.isPending && (
                <p role="status" className="text-sm text-muted-foreground">
                  Checking {previewProgress.done.toLocaleString()} of{" "}
                  {previewProgress.total.toLocaleString()} rows…
                </p>
              )}
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
                  Review before importing
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {preview.rows.length} rows · {previewStats.invalid} invalid ·{" "}
                  {previewStats.duplicates} possible duplicates
                </p>
                {preview.requiresApproval && (
                  <p className="rounded-lg bg-primary/10 p-3 text-xs text-foreground">
                    This board requires creation approval. Imported tasks will
                    wait in the approval queue.
                  </p>
                )}
                {
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Possible duplicates start unchecked. Select one to create
                    another task. Invalid rows must be corrected in the CSV and
                    previewed again.
                  </p>
                }
              </div>
              <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {preview.rows.slice(page * 100, (page + 1) * 100).map((row) => {
                  const status = row.issues.length
                    ? "Invalid"
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
                        disabled={busy || !row.token}
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
                          className={`mt-1 block text-xs ${row.issues.length ? "text-destructive" : "text-muted-foreground"}`}
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
                        {row.duplicate && (
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
              {pageCount > 1 && (
                <nav
                  aria-label="Import preview pagination"
                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Previous
                  </Button>
                  <label className="flex items-center gap-2">
                    Page
                    <input
                      aria-label="Preview page"
                      type="number"
                      min={1}
                      max={pageCount}
                      value={page + 1}
                      className="w-16 rounded-md border border-input bg-background px-2 py-1.5"
                      onChange={(event) =>
                        setPage(
                          Math.max(
                            0,
                            Math.min(
                              pageCount - 1,
                              Number(event.target.value) - 1 || 0,
                            ),
                          ),
                        )
                      }
                    />
                    of {pageCount}
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next
                  </Button>
                </nav>
              )}
              {!busy && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSelected(
                        new Set(
                          preview.rows
                            .filter((row) => row.token && !row.duplicate)
                            .map((row) => row.row),
                        ),
                      )
                    }
                  >
                    Select new valid rows
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear selection
                  </Button>
                </div>
              )}
              <div className="grid gap-3 pb-2">
                {mutation.isPending ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Saving your import recovery copy. Follow the lemon for
                    progress.
                  </p>
                ) : (
                  <>
                    <Button
                      disabled={selected.size === 0 || busy}
                      onClick={() => {
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
