"use client";
import { useState } from "react";
import { FolderInput, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PauseButton,
  PauseClose,
  PauseDialog,
} from "@/components/pause/pause-dialog";
import { PauseAlert } from "@/components/pause/pause-alert";
import { ProjectBadge } from "./project-badge";
import { useProjectAction } from "./use-project-action";

type Target = {
  id: string;
  name: string;
  color: string;
  visibility: "PUBLIC" | "PRIVATE";
};

export function MoveBoard({
  board,
  currentProjectId,
  targets,
  variant = "outline",
}: {
  board: { id: string; name: string };
  currentProjectId: string | null;
  targets: Target[];
  variant?: "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(currentProjectId ?? "");
  const move = useProjectAction("move-board", () => setOpen(false));
  const chosen = targets.find((target) => target.id === choice);
  const changed = (choice || null) !== currentProjectId;
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        onClick={() => {
          setChoice(currentProjectId ?? "");
          move.reset();
          setOpen(true);
        }}
      >
        <FolderInput size={15} />
        Move to…
      </Button>
      <PauseDialog
        open={open}
        onOpenChange={setOpen}
        intent="info"
        title={`Move ${board.name}`}
        description="Tasks, comments and files move with the board."
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              disabled={!changed || move.isPending}
              onClick={() =>
                move.mutate({ boardId: board.id, projectId: choice || null })
              }
            >
              {move.isPending ? "Moving…" : "Move board"}
            </PauseButton>
          </>
        }
      >
        <fieldset className="grid max-h-72 gap-2 overflow-y-auto">
          <legend className="sr-only">Destination</legend>
          {targets.map((target) => (
            <label key={target.id} className="project-choice">
              <input
                type="radio"
                name="move-target"
                checked={choice === target.id}
                onChange={() => setChoice(target.id)}
                className="mt-1"
              />
              <span className="flex items-center gap-2 text-sm font-medium">
                <ProjectBadge name={target.name} color={target.color} />
                {target.name}
                {target.visibility === "PRIVATE" && (
                  <Lock size={13} aria-label="Private project" />
                )}
                {target.id === currentProjectId && (
                  <span className="text-xs font-normal text-muted-foreground">
                    Current
                  </span>
                )}
              </span>
            </label>
          ))}
          <label className="project-choice">
            <input
              type="radio"
              name="move-target"
              checked={choice === ""}
              onChange={() => setChoice("")}
              className="mt-1"
            />
            <span className="text-sm font-medium">No project (standalone)</span>
            <small>Everyone in the workspace can see it</small>
          </label>
        </fieldset>
        {changed && chosen?.visibility === "PRIVATE" && (
          <PauseAlert intent="warning">
            {chosen.name} is private. Only its members will keep access to this
            board; everyone else loses it right away.
          </PauseAlert>
        )}
        {move.error && (
          <p role="alert" className="text-sm text-destructive">
            {move.error.message}
          </p>
        )}
      </PauseDialog>
    </>
  );
}
