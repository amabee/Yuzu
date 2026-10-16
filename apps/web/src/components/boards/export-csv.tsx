"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileDown, Check, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { downloadBoardCsv } from "@/lib/csv-export-client";
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
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"VIEW" | "BOARD">("VIEW");
  const [includeArchived, setIncludeArchived] = useState(false);
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({
      input,
      id,
    }: {
      input: CsvExportRequest;
      id: string;
    }) => {
      onNotice({
        id,
        kind: "loading",
        title: "Exporting CSV",
        message: "Preparing the latest task data…",
        icon: "download",
        dismissible: false,
      });
      return downloadBoardCsv(input, (loaded, total) =>
        onNotice({
          id,
          kind: "loading",
          title: "Downloading CSV",
          message: total
            ? `${Math.round(loaded / 1000)} / ${Math.round(total / 1000)} KB`
            : `${Math.round(loaded / 1000)} KB received`,
          icon: "download",
          dismissible: false,
          ...(total ? { progress: Math.min(99, (loaded / total) * 100) } : {}),
        }),
      );
    },
    onSuccess: (result, { id }) => {
      setOpen(false);
      onNotice({
        id,
        kind: "success",
        title: "CSV exported",
        message: result.filename,
        progress: 100,
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
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="export-sheet-panel w-full gap-6 overflow-y-auto p-6 sm:max-w-md">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Table2 size={20} />
            </span>
            <div>
              <SheetTitle>Export tasks</SheetTitle>
              <SheetDescription className="mt-1">
                Take your board data into a spreadsheet.
              </SheetDescription>
            </div>
          </div>
          <form
            className="grid gap-6"
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
            <fieldset className="grid gap-3" disabled={mutation.isPending}>
              <legend className="mb-3 text-sm font-medium">Export range</legend>
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
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${scope === option.value ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/40"}`}
                >
                  <input
                    className="mt-1 size-4 shrink-0 accent-primary"
                    type="radio"
                    name="export-scope"
                    value={option.value}
                    checked={scope === option.value}
                    onChange={() => setScope(option.value)}
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {option.title}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
              {scope === "BOARD" && (
                <label className="flex items-center gap-3 rounded-md bg-muted/40 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={includeArchived}
                    onChange={(event) =>
                      setIncludeArchived(event.target.checked)
                    }
                  />
                  Include archived tasks
                </label>
              )}
            </fieldset>
            <div className="space-y-3 border-y border-border py-4 text-xs text-muted-foreground">
              <p className="flex items-center gap-2">
                <Check size={14} className="text-primary" />
                Task fields, assignees, checklists, and custom fields
              </p>
              <p>
                Uses the latest accepted task values when the export begins.
              </p>
              <p>UTF-8 CSV. Up to 10,000 tasks or 10 MB per export.</p>
            </div>
            {mutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {mutation.error.message}
              </p>
            )}
            {mutation.isPending && (
              <p role="status" className="text-xs text-muted-foreground">
                You can close this panel. Your download will continue.
              </p>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              <FileDown size={16} />
              {mutation.isPending ? "Preparing CSV…" : "Download CSV"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
