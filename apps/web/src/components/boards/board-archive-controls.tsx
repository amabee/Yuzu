"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "nextjs-toploader/app";
import { Archive, ArchiveRestore } from "lucide-react";
import type { BoardState } from "@/lib/board-contract";
import { apiRequest } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PauseAlert } from "@/components/pause/pause-alert";
import {
  PauseButton,
  PauseClose,
  PauseDialog,
} from "@/components/pause/pause-dialog";

export function BoardArchiveControls({
  state,
  name,
}: {
  state: BoardState;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const archived = Boolean(state.archivedAt);
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("/api/v1/boards/archive-board", {
        method: "POST",
        json: {
          boardId: state.boardId,
          archived: !archived,
          version: state.boardVersion,
        },
      }),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["principal", state.currentUserId],
      });
      router.refresh();
    },
  });
  const action =
    state.canArchive && state.boardVersion ? (
      <Button
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => {
          mutation.reset();
          setOpen(true);
        }}
      >
        {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        {archived ? "Restore board" : "Archive board"}
      </Button>
    ) : null;
  return (
    <>
      {state.readOnly ? (
        <PauseAlert intent="warning" className="mb-4" action={action}>
          {archived
            ? "Archived board, read-only."
            : "Archived project, read-only."}
          {state.projectArchived
            ? " Restore the project to make edits; independently archived boards also need restoring."
            : " Restore the board to make edits. Nothing is deleted."}
        </PauseAlert>
      ) : action ? (
        <div className="mb-3 flex justify-end">{action}</div>
      ) : null}
      <PauseDialog
        open={open}
        onOpenChange={(value) => {
          if (!mutation.isPending) setOpen(value);
        }}
        intent={archived ? "info" : "warning"}
        title={`${archived ? "Restore" : "Archive"} ${name}?`}
        description={
          archived
            ? state.projectArchived
              ? "The board will remain read-only until its project is restored."
              : "The board will return to active navigation. Individually archived tasks stay archived."
            : "This board will leave active navigation and become read-only. Its tasks, files and pending approvals are kept. Find it again using Search archived."
        }
        actions={
          <>
            <PauseClose asChild>
              <PauseButton disabled={mutation.isPending}>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? "Saving…"
                : archived
                  ? "Restore board"
                  : "Archive board"}
            </PauseButton>
          </>
        }
      >
        {mutation.error && (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        )}
      </PauseDialog>
    </>
  );
}
