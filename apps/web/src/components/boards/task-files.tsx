"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Download,
  Paperclip,
  Trash2,
  Upload,
  X,
  FolderOpen,
  Image as ImageIcon,
  Sheet,
  Presentation,
  ChevronDown,
  LoaderCircle,
} from "lucide-react";
import {
  attachmentListSchema,
  attachmentTypes,
  formatFileSize,
} from "@/lib/attachment-contract";
import { apiRequest } from "@/lib/api-client";
import { uploadTaskFile, downloadTaskFile } from "@/lib/upload-attachment";
import type { BoardState, BoardTask } from "@/lib/board-contract";
import { Button } from "@/components/ui/button";

function FileIcon({ mimeType }: { mimeType: string }) {
  const Icon = mimeType.startsWith("image/")
    ? ImageIcon
    : /spreadsheet|csv/.test(mimeType)
      ? Sheet
      : mimeType.includes("presentation")
        ? Presentation
        : FileText;
  return <Icon size={20} aria-hidden="true" />;
}

export function TaskFiles({
  state,
  task,
  active,
  syncInterval,
  onNotice,
}: {
  state: BoardState;
  task: BoardTask;
  active: boolean;
  syncInterval: number;
  onNotice: (message: string, kind: "success" | "error") => void;
}) {
  const client = useQueryClient();
  const queryKey = ["principal", state.currentUserId, "task-files", task.id];
  const [selection, setSelection] = useState<{
    file: File;
    key: string;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const query = useQuery({
    queryKey,
    enabled: active,
    staleTime: 0,
    refetchInterval: active ? syncInterval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async ({ signal }) =>
      attachmentListSchema.parse(
        (
          await apiRequest(`/api/v1/attachments?taskId=${task.id}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      ),
  });
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey }),
      client.invalidateQueries({
        queryKey: ["principal", state.currentUserId, "boards", state.boardId],
      }),
    ]);
  const upload = useMutation({
    mutationKey: queryKey,
    mutationFn: async (selected: NonNullable<typeof selection>) => {
      controller.current = new AbortController();
      setProgress(0);
      return uploadTaskFile(
        task.id,
        selected.file,
        selected.key,
        setProgress,
        controller.current.signal,
      );
    },
    onSuccess: async () => {
      setSelection(null);
      if (input.current) input.current.value = "";
      onNotice("File uploaded.", "success");
      await refresh();
    },
    onError: (error) => {
      if (error.name !== "AbortError") onNotice(error.message, "error");
      void refresh();
    },
  });
  const remove = useMutation({
    mutationKey: queryKey,
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/attachments/${id}`, { method: "DELETE", json: {} }),
    onSuccess: async () => {
      setRemoving(null);
      onNotice("File removed.", "success");
      await refresh();
    },
    onError: (error) => {
      onNotice(error.message, "error");
      void refresh();
    },
  });
  const download = useMutation({
    mutationFn: (file: { id: string; fileName: string }) =>
      downloadTaskFile(file.id, file.fileName),
    onSuccess: () => onNotice("Download started.", "success"),
    onError: (error) => onNotice(error.message, "error"),
  });
  const data = query.data;
  const accept = data?.allowedMimeTypes
    .flatMap((mime) => attachmentTypes[mime]?.map((ext) => `.${ext}`) ?? [])
    .join(",");
  return (
    <div className="task-files-panel space-y-5">
      <div className="task-files-heading">
        <div>
          <h3 className="task-section-heading">
            <Paperclip size={15} />
            Files
          </h3>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            Everything this task needs, in one place.
          </p>
        </div>
        {data && (
          <span className="task-files-count">
            {data.files.length} {data.files.length === 1 ? "file" : "files"}
          </span>
        )}
      </div>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading files…
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
      {data && (
        <>
          {data.canUpload ? (
            <div className="task-file-upload">
              <div className="task-file-upload-intro">
                <span className="task-file-upload-icon">
                  <Upload size={22} aria-hidden="true" />
                </span>
                <h4>Add a reference</h4>
                <p>Share a document, image, or the latest deliverable.</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={upload.isPending || remove.isPending}
                  onClick={() => input.current?.click()}
                >
                  <Paperclip size={14} />
                  {selection ? "Choose another file" : "Browse files"}
                </Button>
              </div>
              <input
                ref={input}
                id={`task-file-${task.id}`}
                type="file"
                aria-label="Choose a file"
                accept={accept}
                disabled={upload.isPending || remove.isPending}
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  upload.reset();
                  setSelection(
                    file ? { file, key: crypto.randomUUID() } : null,
                  );
                }}
              />
              {selection && (
                <div className="task-file-selection">
                  <div className="flex items-center gap-3">
                    <span className="task-file-type">
                      <FileIcon mimeType={selection.file.type} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-xs font-medium">
                        {selection.file.name}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatFileSize(selection.file.size)}
                        {!upload.isPending && " • Selected"}
                      </p>
                    </div>
                    {!upload.isPending && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Clear selected file"
                        onClick={() => {
                          setSelection(null);
                          upload.reset();
                          if (input.current) input.current.value = "";
                        }}
                      >
                        <X size={14} />
                      </Button>
                    )}
                  </div>
                  {selection.file.size > data.maxSizeBytes ? (
                    <p role="alert" className="mt-2 text-xs text-destructive">
                      Choose a file smaller than{" "}
                      {formatFileSize(data.maxSizeBytes)}.
                    </p>
                  ) : selection.file.size === 0 ? (
                    <p role="alert" className="mt-2 text-xs text-destructive">
                      Choose a non-empty file.
                    </p>
                  ) : (
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={upload.isPending || remove.isPending}
                        onClick={() => upload.mutate(selection)}
                      >
                        <Upload size={14} />
                        {upload.isPending
                          ? "Uploading…"
                          : upload.isError
                            ? "Retry upload"
                            : "Upload file"}
                      </Button>
                      {upload.isPending && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => controller.current?.abort()}
                        >
                          <X size={14} />
                          Cancel upload
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {upload.isPending && (
                <div className="mt-3">
                  <progress
                    className="h-1.5 w-full accent-primary"
                    aria-label="File upload progress"
                    value={progress}
                    max={100}
                  />
                  <p
                    role="status"
                    className="mt-1 text-xs text-muted-foreground"
                  >
                    {progress}%
                    {progress >= 99 ? " · Validating and saving…" : " uploaded"}
                  </p>
                </div>
              )}
              {upload.error && upload.error.name !== "AbortError" && (
                <p role="alert" className="mt-3 text-xs text-destructive">
                  {upload.error.message}
                </p>
              )}
              <details className="task-file-policy">
                <summary>
                  <span>
                    Up to {formatFileSize(data.maxSizeBytes)} per file
                  </span>
                  <span>
                    File types <ChevronDown size={12} aria-hidden="true" />
                  </span>
                </summary>
                <p>
                  {data.allowedMimeTypes
                    .flatMap((mime) => attachmentTypes[mime] ?? [])
                    .map((ext) => ext.toUpperCase())
                    .join(", ")}
                </p>
              </details>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {task.archivedAt
                ? "Archived tasks keep their files. Restore this task to make changes."
                : "Task editors can upload files. You can download the files below."}
            </p>
          )}
          <div>
            <div className="task-files-list-heading">
              <h4>Attached files</h4>
              <span>{data.files.length}</span>
            </div>
            {data.files.length === 0 ? (
              <div className="task-files-empty">
                <span className="task-files-empty-icon">
                  <FolderOpen size={26} strokeWidth={1.4} aria-hidden="true" />
                  <Paperclip size={13} aria-hidden="true" />
                </span>
                <p className="text-xs font-medium">No files attached yet</p>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  {data.canUpload
                    ? "Add the first reference to keep everyone on the same page."
                    : "Uploaded files will appear here."}
                </p>
              </div>
            ) : (
              <ul className="task-files-list" aria-label="Task files">
                {data.files.map((file) => (
                  <li key={file.id}>
                    <div className="flex items-start gap-2.5">
                      <span className="task-file-type">
                        <FileIcon mimeType={file.mimeType} />
                        <span>
                          {file.fileName.split(".").pop()?.slice(0, 5)}
                        </span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-xs font-medium leading-5">
                          {file.fileName}
                        </p>
                        <p className="mt-1 break-words text-[11px] text-muted-foreground">
                          {formatFileSize(file.sizeBytes)} ·{" "}
                          {file.uploadedByName}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Added{" "}
                          {new Date(file.createdAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric", year: "numeric" },
                          )}
                        </p>
                      </div>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={download.isPending}
                        aria-label={`Download ${file.fileName}`}
                        onClick={() => download.mutate(file)}
                      >
                        {download.isPending &&
                        download.variables?.id === file.id ? (
                          <LoaderCircle
                            size={15}
                            className="animate-spin motion-reduce:animate-none"
                          />
                        ) : (
                          <Download size={15} />
                        )}
                      </Button>
                      {file.canRemove && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${file.fileName}`}
                          disabled={remove.isPending || upload.isPending}
                          onClick={() => setRemoving(file.id)}
                        >
                          <Trash2 size={15} className="text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                    {removing === file.id && (
                      <div
                        role="group"
                        aria-label={`Confirm removal of ${file.fileName}`}
                        className="mt-3 space-y-2 border-t pt-3"
                      >
                        <p className="text-xs">
                          Remove this file? It will no longer be available for
                          download.
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(file.id)}
                          >
                            Remove file
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={remove.isPending}
                            onClick={() => setRemoving(null)}
                          >
                            Keep file
                          </Button>
                        </div>
                        {remove.error && (
                          <p role="alert" className="text-xs text-destructive">
                            {remove.error.message}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
