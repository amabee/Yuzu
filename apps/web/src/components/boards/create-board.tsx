"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "nextjs-toploader/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiRequest } from "@/lib/api-client";
export function CreateBoard({
  workspaces,
}: {
  workspaces: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const router = useRouter();
  const mutation = useMutation({
    mutationFn: async () =>
      (
        await apiRequest<{ id: string }>("/api/v1/boards/create-board", {
          method: "POST",
          json: { workspaceId, name },
        })
      ).data,
    onSuccess: (board) => {
      setOpen(false);
      router.push(`/boards/${board.id}`);
      router.refresh();
    },
  });
  return (
    <>
      <Button disabled={!workspaces.length} onClick={() => setOpen(true)}>
        Create board
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="board-details-panel">
          <SheetTitle>Create board</SheetTitle>
          <SheetDescription>
            Start with task names, statuses, assignees, priorities, and dates.
            New boards use direct editing.
          </SheetDescription>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <label className="task-field-label">
              Board name
              <Input
                aria-label="Board name"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="task-field-label">
              Workspace
              <select
                aria-label="Board workspace"
                className="task-select"
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            {mutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {mutation.error.message}
              </p>
            )}
            <Button className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create board"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
