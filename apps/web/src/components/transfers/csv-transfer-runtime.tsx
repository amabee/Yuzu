"use client";
import Image from "next/image";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createRecordId } from "@yuzu/database/ids";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, ApiError } from "@/lib/api-client";
import {
  transferSchema,
  activeTransfer,
  type CsvTransfer,
} from "@/lib/csv-transfer-contract";
import {
  readTransferDrafts,
  saveTransferDraft,
  removeTransferDraft,
  uploadChunks,
} from "@/lib/csv-transfer-drafts";
import type { ImportRow } from "@/lib/csv-import";
import type { CsvExportRequest } from "@/lib/csv-export";
import { useUiStore } from "@/components/providers";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";
import { saveResponseDownload } from "@/lib/download-file";

const Context = createContext<{
  startImport: (
    boardId: string,
    name: string,
    rows: ImportRow[],
  ) => Promise<string>;
  startExport: (input: CsvExportRequest) => Promise<string>;
} | null>(null);
export function useCsvTransfers() {
  const value = useContext(Context);
  if (!value) throw new Error("CSV transfers require the workspace runtime.");
  return value;
}
export function CsvTransferRuntime({
  principalId,
  children,
}: {
  principalId: string;
  children: React.ReactNode;
}) {
  const client = useQueryClient();
  const [uploadError, setUploadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [downloadNotice, setDownloadNotice] = useState<YuzuToastNotice | null>(
    null,
  );
  const download = useMutation({
    retry: false,
    mutationFn: async ({
      job,
      report,
      noticeId,
    }: {
      job: CsvTransfer;
      report: boolean;
      noticeId: string;
    }) => {
      const id = noticeId;
      const filename = report
        ? "yuzu-import-results.csv"
        : (job.filename ?? "yuzu-export.csv");
      setDownloadNotice({
        id,
        kind: "loading",
        title: "Downloading CSV",
        message: filename,
        icon: "download",
        dismissible: false,
      });
      const response = await fetch(
        `/api/v1/transfers/${job.id}?${report ? "report" : "download"}=1`,
        { credentials: "same-origin", cache: "no-store" },
      );
      await saveResponseDownload(
        response,
        filename,
        (loaded, total) =>
          setDownloadNotice({
            id,
            kind: "loading",
            title: "Downloading CSV",
            message: `${Math.round(loaded / 1000)}${total ? ` / ${Math.round(total / 1000)}` : ""} KB received`,
            icon: "download",
            dismissible: false,
            ...(total ? { progress: (loaded / total) * 100 } : {}),
          }),
        report ? 50_000_000 : 10_000_000,
      );
      return filename;
    },
    onSuccess: (filename, { noticeId }) =>
      setDownloadNotice({
        id: noticeId,
        kind: "success",
        title: "Download started",
        message: filename,
      }),
    onError: (error, { noticeId }) =>
      setDownloadNotice({
        id: noticeId,
        kind: "error",
        title: "Download failed",
        message: error.message,
      }),
  });
  const open = useUiStore((state) => state.transferPanelOpen);
  const setOpen = useUiStore((state) => state.setTransferPanelOpen);
  const queryKey = ["principal", principalId, "csv-transfers"];
  const jobs = useQuery({
    queryKey,
    queryFn: async () =>
      z
        .array(transferSchema)
        .parse(
          (await apiRequest("/api/v1/transfers", { cache: "no-store" })).data,
        ),
    refetchInterval: (query) =>
      query.state.data?.some((job) => activeTransfer(job.status))
        ? 5000
        : 30_000,
    retry: (count, error) =>
      count < 2 &&
      !(error instanceof ApiError && [401, 403].includes(error.status)),
  });
  const wake = useRef<() => void>(() => {});
  const refresh = useCallback(
    () =>
      client.invalidateQueries({
        queryKey: ["principal", principalId, "csv-transfers"],
      }),
    [client, principalId],
  );
  useEffect(() => {
    const abort = new AbortController();
    let busy = false;
    async function drain() {
      if (busy || abort.signal.aborted || !navigator.onLine) return;
      busy = true;
      try {
        const drafts = await readTransferDrafts();
        for (const draft of drafts) {
          if (draft.ownerId !== principalId || abort.signal.aborted) continue;
          if (Date.now() - draft.createdAt > 86_400_000) {
            await removeTransferDraft(draft.id);
            setUploadError(
              "An unfinished upload expired. Preview that CSV again to start a new import.",
            );
            continue;
          }
          try {
            setPendingName(draft.name);
            await apiRequest("/api/v1/transfers", {
              method: "POST",
              json: {
                id: draft.id,
                kind: "IMPORT",
                boardId: draft.boardId,
                name: draft.name,
                total: draft.total,
                chunkCount: draft.chunks.length,
              },
              signal: abort.signal,
            });
            await refresh();
            setPendingName("");
            const { data } = await apiRequest<{
              status: string;
              uploaded: number[];
            }>(`/api/v1/transfers/${draft.id}`, { signal: abort.signal });
            if (data.status === "UPLOADING") {
              const received = new Set(data.uploaded);
              for (let index = 0; index < draft.chunks.length; index++) {
                if (received.has(index)) continue;
                await apiRequest(`/api/v1/transfers/${draft.id}`, {
                  method: "POST",
                  json: { action: "chunk", index, rows: draft.chunks[index] },
                  signal: abort.signal,
                });
                await refresh();
              }
              await apiRequest(`/api/v1/transfers/${draft.id}`, {
                method: "POST",
                json: { action: "start" },
                signal: abort.signal,
              });
            }
            await removeTransferDraft(draft.id);
            setUploadError("");
            await refresh();
          } catch (error) {
            setPendingName("");
            if (abort.signal.aborted) break;
            if (
              error instanceof ApiError &&
              [403, 404, 410, 422].includes(error.status)
            ) {
              await removeTransferDraft(draft.id);
              setUploadError(
                `${draft.name}: ${error.message} Preview the file again if needed.`,
              );
            } else
              setUploadError(
                `${draft.name}: Upload paused. Your recovery copy is saved; Yuzu will retry while this workspace is open.`,
              );
            break;
          }
        }
      } catch (error) {
        if (!abort.signal.aborted)
          setUploadError(
            error instanceof Error
              ? error.message
              : "Upload recovery is unavailable.",
          );
      } finally {
        busy = false;
      }
    }
    const run = () => {
      // Only one tab uploads a saved draft at a time; server chunks are also idempotent.
      if (navigator.locks)
        void navigator.locks.request(
          `yuzu-csv-${principalId}`,
          { ifAvailable: true },
          (lock) => (lock ? drain() : Promise.resolve()),
        );
      else void drain();
    };
    wake.current = run;
    run();
    const timer = setInterval(run, 10_000);
    window.addEventListener("online", run);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("online", run);
      wake.current = () => {};
    };
  }, [principalId, refresh]);

  const startImport = async (
    boardId: string,
    name: string,
    rows: ImportRow[],
  ) => {
    const id = createRecordId();
    setSaving(true);
    setOpen(true);
    try {
      await saveTransferDraft({
        id,
        ownerId: principalId,
        boardId,
        name,
        total: rows.length,
        chunks: uploadChunks(rows),
        createdAt: Date.now(),
      });
      setPendingName(name);
      wake.current();
      return id;
    } finally {
      setSaving(false);
    }
  };
  const startExport = async (input: CsvExportRequest) => {
    const id = createRecordId();
    await apiRequest("/api/v1/transfers", {
      method: "POST",
      json: { id, kind: "EXPORT", input },
    });
    setOpen(true);
    await refresh();
    return id;
  };
  const action = async (job: CsvTransfer, value: string) => {
    try {
      setActionError("");
      await apiRequest(`/api/v1/transfers/${job.id}`, {
        method: "POST",
        json: { action: value },
      });
      if (value === "cancel") await removeTransferDraft(job.id);
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Try this action again.",
      );
    }
  };
  const list = jobs.data ?? [],
    active = list.filter((job) => activeTransfer(job.status));
  const latest = active[0] ?? list[0];
  const percent = latest
    ? latest.total
      ? Math.round((latest.done / latest.total) * 100)
      : latest.status === "COMPLETED"
        ? 100
        : 0
    : 0;
  const label = latest
    ? transferLabel(latest)
    : saving
      ? "Saving recovery copy…"
      : "CSV activity";
  const visible =
    list.length > 0 || saving || Boolean(uploadError) || Boolean(pendingName);
  return (
    <Context.Provider value={{ startImport, startExport }}>
      {children}
      <YuzuToast notice={downloadNotice} />
      {visible && (
        <aside className="csv-activity" aria-label="CSV activity">
          {open && (
            <section
              className="csv-activity-panel"
              aria-label="Transfer progress"
            >
              <header className="flex items-start justify-between gap-3 border-b border-border p-4">
                <div>
                  <h2 className="text-sm font-semibold">Your transfers</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Keep working. Processing continues on the server.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Collapse transfers"
                  onClick={() => setOpen(false)}
                >
                  <ChevronDown size={16} />
                </Button>
              </header>
              <div className="max-h-[min(60vh,480px)] overflow-y-auto">
                {saving && (
                  <p className="p-4 text-sm" role="status">
                    Saving your import recovery copy…
                  </p>
                )}
                {pendingName && !saving && (
                  <p className="p-4 text-sm" role="status">
                    Connecting upload: {pendingName}
                  </p>
                )}
                {(uploadError || actionError || jobs.error) && (
                  <p
                    role="alert"
                    className="m-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive"
                  >
                    {actionError || uploadError || jobs.error?.message}
                  </p>
                )}
                {list.map((job) => (
                  <article
                    key={job.id}
                    className="space-y-3 border-b border-border p-4 last:border-0"
                    aria-label={`${job.kind === "IMPORT" ? "Import" : "Export"}: ${job.name}`}
                  >
                    <div className="flex items-start gap-2">
                      {job.kind === "IMPORT" ? (
                        <ArrowUpFromLine
                          size={16}
                          className="mt-0.5 shrink-0 text-primary"
                        />
                      ) : (
                        <ArrowDownToLine
                          size={16}
                          className="mt-0.5 shrink-0 text-primary"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {job.name}
                        </p>
                        <p
                          className="mt-1 text-xs text-muted-foreground"
                          role="status"
                        >
                          {transferLabel(job)}
                        </p>
                      </div>
                      {!activeTransfer(job.status) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Dismiss ${job.name}`}
                          onClick={() => void action(job, "dismiss")}
                        >
                          <X size={14} />
                        </Button>
                      )}
                    </div>
                    {activeTransfer(job.status) && (
                      <>
                        <progress
                          className="h-1.5 w-full accent-primary"
                          aria-label={`${job.name} progress`}
                          max={Math.max(job.total, 1)}
                          value={
                            job.kind === "EXPORT" && job.status === "RUNNING"
                              ? undefined
                              : job.status === "QUEUED"
                                ? 0
                                : job.done
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          {job.status === "UPLOADING"
                            ? "Upload resumes here after a refresh. Keep this browser's recovery data until it finishes."
                            : "You can navigate, refresh, or close this tab."}
                        </p>
                      </>
                    )}
                    {job.kind === "IMPORT" &&
                      job.done > 0 &&
                      job.status !== "UPLOADING" && (
                        <p className="text-xs text-muted-foreground">
                          {job.summary.APPLIED ?? 0} created ·{" "}
                          {job.summary.PENDING_APPROVAL ?? 0} awaiting approval
                          · {job.summary.SKIPPED ?? 0} skipped ·{" "}
                          {job.summary.FAILED ?? 0} failed
                        </p>
                      )}
                    {job.error && (
                      <p className="text-xs text-destructive">{job.error}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <Link
                        href={`/boards/${job.boardId}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Open board
                      </Link>
                      {job.kind === "EXPORT" && job.status === "COMPLETED" && (
                        <a
                          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground"
                          href={`/api/v1/transfers/${job.id}?download=1`}
                          aria-disabled={download.isPending}
                          onClick={(event) => {
                            event.preventDefault();
                            if (!download.isPending)
                              download.mutate({
                                job,
                                report: false,
                                noticeId: createRecordId(),
                              });
                          }}
                        >
                          <ArrowDownToLine size={12} />
                          Download CSV
                        </a>
                      )}
                      {job.kind === "IMPORT" &&
                        !activeTransfer(job.status) &&
                        job.done > 0 && (
                          <a
                            className="text-primary hover:underline"
                            href={`/api/v1/transfers/${job.id}?report=1`}
                            aria-disabled={download.isPending}
                            onClick={(event) => {
                              event.preventDefault();
                              if (!download.isPending)
                                download.mutate({
                                  job,
                                  report: true,
                                  noticeId: createRecordId(),
                                });
                            }}
                          >
                            Results CSV
                          </a>
                        )}
                      {(job.status === "FAILED" ||
                        (job.status === "COMPLETED" &&
                          Boolean(job.summary.FAILED))) && (
                        <button
                          className="inline-flex items-center gap-1 text-primary"
                          onClick={() => void action(job, "retry")}
                        >
                          <RotateCcw size={12} />
                          {job.kind === "EXPORT"
                            ? "Retry export"
                            : "Retry unfinished rows"}
                        </button>
                      )}
                      {activeTransfer(job.status) && (
                        <button
                          className="ml-auto text-muted-foreground hover:text-destructive"
                          onClick={() => void action(job, "cancel")}
                        >
                          Stop
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              <p className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
                Files and results are kept for 24 hours after completion.
              </p>
            </section>
          )}
          <div className="flex items-center justify-end gap-3">
            <div className="csv-activity-caption">
              <span className="block text-xs font-medium">
                {active.length > 1
                  ? `${active.length} active transfers`
                  : label}
              </span>
              <span className="mt-0.5 block max-w-44 truncate text-[11px] text-muted-foreground">
                {latest?.name ?? "Preparing your import"}
              </span>
            </div>
            <button
              className="csv-lemon"
              aria-label={`Show transfers: ${label}`}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <svg
                viewBox="0 0 80 80"
                className="csv-lemon-ring"
                aria-hidden="true"
              >
                <circle
                  cx="40"
                  cy="40"
                  r="35"
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="3"
                />
                <circle
                  cx="40"
                  cy="40"
                  r="35"
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray="219.91"
                  strokeDashoffset={219.91 * (1 - percent / 100)}
                />
              </svg>
              <Image src="/logo.svg" width={76} height={76} alt="" />
              <span className="csv-lemon-count">
                {active.length ? (
                  latest?.kind === "EXPORT" ? (
                    "..."
                  ) : (
                    `${percent}%`
                  )
                ) : (
                  <Check size={12} />
                )}
              </span>
            </button>
          </div>
        </aside>
      )}
    </Context.Provider>
  );
}
function transferLabel(job: CsvTransfer) {
  if (job.status === "UPLOADING")
    return `Uploading · ${job.done.toLocaleString()} / ${job.total.toLocaleString()} rows`;
  if (job.status === "QUEUED") return "Queued";
  if (job.status === "RUNNING")
    return job.kind === "EXPORT"
      ? "Preparing export…"
      : `Importing · ${job.done.toLocaleString()} / ${job.total.toLocaleString()} rows`;
  if (job.status === "COMPLETED")
    return job.kind === "EXPORT"
      ? "Ready to download"
      : job.summary.FAILED
        ? "Completed with row errors"
        : "Import complete";
  return job.status === "FAILED" ? "Needs attention" : "Stopped";
}
