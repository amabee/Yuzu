"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PauseButton,
  PauseClose,
  PauseModal,
} from "@/components/pause/pause-dialog";
import { PauseAlert } from "@/components/pause/pause-alert";
import { useCsvTransfers } from "@/components/transfers/csv-transfer-runtime";
import type { CsvExportRequest } from "@/lib/csv-export";
import type { ViewConfig } from "@/lib/saved-view-contract";
import type { TransferNoticeHandler } from "@/components/ui/yuzu-toast";

export function ExportCsv({
  boardId,
  config,
  count,
  onNotice,
}: {
  boardId: string;
  config: ViewConfig;
  count: number;
  onNotice: TransferNoticeHandler;
}) {
  const { startExport } = useCsvTransfers();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"VIEW" | "BOARD">("VIEW");
  const [includeArchived, setIncludeArchived] = useState(false);
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ input }: { input: CsvExportRequest; id: string }) =>
      startExport(input),
    onSuccess: () => {
      setOpen(false);
      onNotice({
        id: crypto.randomUUID(),
        kind: "info",
        title: "Export queued",
        message:
          "Yuzu is preparing your CSV. Download it from the lemon when ready.",
      });
    },
    onError: (error, { id }) =>
      onNotice({
        id,
        kind: "error",
        title: "Export failed",
        message: error.message,
      }),
  });
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => {
          mutation.reset();
          setScope("VIEW");
          setIncludeArchived(false);
          setOpen(true);
        }}
      >
        <FileDown size={14} />
        {mutation.isPending ? "Exporting…" : "Export CSV"}
      </Button>
      <PauseModal
        open={open}
        onOpenChange={setOpen}
        title="Export tasks"
        description="Take your board data into a spreadsheet."
        as="form"
        footer="UTF-8 CSV, up to 10,000 tasks or 10 MB."
        actions={
          <>
            <PauseClose asChild>
              <PauseButton type="button">Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              type="submit"
              disabled={mutation.isPending}
            >
              <FileDown size={15} />
              {mutation.isPending ? "Preparing CSV…" : "Download CSV"}
            </PauseButton>
          </>
        }
        onSubmit={(event) => {
          event.preventDefault();
          if (!mutation.isPending)
            mutation.mutate({
              id: crypto.randomUUID(),
              input:
                scope === "VIEW"
                  ? { boardId, scope, config }
                  : { boardId, scope, includeArchived },
            });
        }}
      >
        <fieldset className="grid gap-2" disabled={mutation.isPending}>
          <legend className="task-field-label mb-2">Export range</legend>
          {(
            [
              {
                value: "VIEW",
                title: "Current view",
                description: `${count} matching ${count === 1 ? "task" : "tasks"}. Keeps your filters and sorting.`,
              },
              {
                value: "BOARD",
                title: "Entire board",
                description:
                  "All active tasks, regardless of your current filters.",
              },
            ] as const
          ).map((option) => (
            <label key={option.value} className="project-choice">
              <input
                className="mt-1"
                type="radio"
                name="export-scope"
                value={option.value}
                checked={scope === option.value}
                onChange={() => setScope(option.value)}
              />
              <span className="text-sm font-medium">{option.title}</span>
              <small>{option.description}</small>
            </label>
          ))}
          {scope === "BOARD" && (
            <label className="flex items-center gap-3 px-1 pt-1 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
              />
              Include archived tasks
            </label>
          )}
        </fieldset>
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Check size={14} className="mt-0.5 shrink-0 text-primary" />
          Task fields, assignees, checklists and custom fields, using the latest
          accepted values when the export begins.
        </p>
        {mutation.error && (
          <PauseAlert intent="danger">{mutation.error.message}</PauseAlert>
        )}
        {mutation.isPending && (
          <p role="status" className="text-xs text-muted-foreground">
            You can close this. Your export continues across navigation and
            refresh.
          </p>
        )}
      </PauseModal>
    </>
  );
}
