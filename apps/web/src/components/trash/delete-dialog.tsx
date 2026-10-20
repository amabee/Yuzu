"use client";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import {
  PauseButton,
  PauseClose,
  PauseDialog,
} from "@/components/pause/pause-dialog";

/** Confirms moving a board or project to Trash, then calls the endpoint. */
export function DeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  action,
  id,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirm: string;
  /** "delete-board" or "delete-project". */
  action: "delete-board" | "delete-project";
  id: string;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/trash/${action}`, { method: "POST", json: { id } }),
    onSuccess: () => {
      onOpenChange(false);
      onDeleted();
    },
  });
  return (
    <PauseDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remove.reset();
        onOpenChange(next);
      }}
      intent="danger"
      title={title}
      description={description}
      actions={
        <>
          <PauseClose asChild>
            <PauseButton>Cancel</PauseButton>
          </PauseClose>
          <PauseButton
            tone="primary"
            data-autofocus
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Deleting…" : confirm}
          </PauseButton>
        </>
      }
    >
      {remove.error && (
        <p role="alert" className="text-sm text-destructive">
          {remove.error.message}
        </p>
      )}
    </PauseDialog>
  );
}
