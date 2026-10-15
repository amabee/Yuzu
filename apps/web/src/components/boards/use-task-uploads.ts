"use client";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadTaskFile } from "@/lib/upload-attachment";
import { formatFileSize } from "@/lib/attachment-contract";
import type { TransferNoticeHandler } from "@/components/ui/yuzu-toast";

type Selection = { file: File; key: string };
type UploadJob = {
  id: string;
  selection: Selection | null;
  progress: number;
  status: "uploading" | "success" | "error" | "cancelled";
  error?: Error;
};
type UploadInput = {
  id: string;
  taskId: string;
  selection: Selection;
  controller: AbortController;
};

/** Owned by the board so closing or switching task sheets cannot cancel a transfer. */
export function useTaskUploads(
  userId: string,
  boardId: string,
  notify: TransferNoticeHandler,
) {
  const client = useQueryClient();
  const active = useRef(new Map<string, UploadInput>());
  const [jobs, setJobs] = useState<Record<string, UploadJob>>({});
  const refresh = (taskId: string) =>
    Promise.all([
      client.invalidateQueries({
        queryKey: ["principal", userId, "task-files", taskId],
      }),
      client.invalidateQueries({
        queryKey: ["principal", userId, "boards", boardId],
      }),
    ]);
  const mutation = useMutation({
    mutationKey: ["principal", userId, "task-uploads", boardId],
    retry: false,
    mutationFn: (input: UploadInput) =>
      uploadTaskFile(
        input.taskId,
        input.selection.file,
        input.selection.key,
        (percent) => {
          const progress = Math.min(percent, 99);
          setJobs((current) => ({
            ...current,
            [input.taskId]: { ...current[input.taskId], progress },
          }));
          notify({
            id: input.id,
            kind: "loading",
            icon: "upload",
            dismissible: false,
            title: progress >= 99 ? "Uploading · Saving file…" : "Uploading",
            message: `${input.selection.file.name} · ${formatFileSize(input.selection.file.size)}${progress >= 99 ? " · Validating and saving" : ""}`,
            progress,
          });
        },
        input.controller.signal,
      ),
    onSuccess: (_result, input) => {
      setJobs((current) => ({
        ...current,
        [input.taskId]: {
          id: input.id,
          status: "success",
          selection: null,
          progress: 100,
        },
      }));
      notify({
        id: input.id,
        kind: "success",
        title: "File uploaded",
        message: input.selection.file.name,
        progress: 100,
      });
    },
    onError: (error, input) => {
      const cancelled = error.name === "AbortError";
      setJobs((current) => ({
        ...current,
        [input.taskId]: {
          id: input.id,
          status: cancelled ? "cancelled" : "error",
          selection: input.selection,
          error,
          progress: current[input.taskId]?.progress ?? 0,
        },
      }));
      notify({
        id: input.id,
        kind: cancelled ? "neutral" : "error",
        title: cancelled ? "Upload cancelled" : "Upload failed",
        message: cancelled ? "You can retry when you’re ready." : error.message,
      });
    },
    onSettled: (_result, _error, input) => {
      active.current.delete(input.taskId);
      return refresh(input.taskId);
    },
  });
  return {
    jobs,
    start(taskId: string, selection: Selection) {
      if (active.current.has(taskId)) return;
      const input = {
        id: crypto.randomUUID(),
        taskId,
        selection,
        controller: new AbortController(),
      };
      active.current.set(taskId, input);
      setJobs((current) => ({
        ...current,
        [taskId]: { id: input.id, selection, status: "uploading", progress: 0 },
      }));
      notify(
        {
          id: input.id,
          kind: "loading",
          title: "Uploading",
          icon: "upload",
          dismissible: false,
          message: `${selection.file.name} · ${formatFileSize(selection.file.size)}`,
          progress: 0,
        },
        true,
      );
      mutation.mutate(input);
    },
    cancel(taskId: string) {
      active.current.get(taskId)?.controller.abort();
    },
    reset(taskId: string) {
      if (active.current.has(taskId)) return;
      setJobs((current) => {
        const remaining = { ...current };
        delete remaining[taskId];
        return remaining;
      });
    },
  };
}
export type TaskUploads = ReturnType<typeof useTaskUploads>;
