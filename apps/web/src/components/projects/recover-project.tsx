"use client";
import { useState } from "react";
import { useRouter } from "nextjs-toploader/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PauseButton,
  PauseClose,
  PauseDialog,
} from "@/components/pause/pause-dialog";
import { useProjectAction } from "./use-project-action";

export function RecoverProject({
  project,
}: {
  project: { id: string; name: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const recover = useProjectAction("recover", () => {
    setOpen(false);
    router.push(`/projects/${project.id}`);
  });
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setConfirmName("");
          recover.reset();
          setOpen(true);
        }}
      >
        Recover access
      </Button>
      <PauseDialog
        open={open}
        onOpenChange={setOpen}
        intent="danger"
        title={`Recover access to ${project.name}?`}
        description="You'll become a manager and see all of its boards. Its current managers get an email, and the recovery is recorded in the access log."
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              type="submit"
              form={`recover-${project.id}`}
              disabled={confirmName !== project.name || recover.isPending}
            >
              {recover.isPending ? "Recovering…" : "Recover access"}
            </PauseButton>
          </>
        }
      >
        <form
          id={`recover-${project.id}`}
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmName === project.name)
              recover.mutate({ projectId: project.id, confirmName });
          }}
        >
          <label className="pause-field" htmlFor={`recover-name-${project.id}`}>
            <span>
              Type <b className="text-[var(--tint)]">{project.name}</b> to
              confirm
            </span>
          </label>
          <Input
            id={`recover-name-${project.id}`}
            aria-label="Project name to confirm"
            autoComplete="off"
            data-autofocus
            placeholder={project.name}
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
          {recover.error && (
            <p role="alert" className="text-sm text-destructive">
              {recover.error.message}
            </p>
          )}
        </form>
      </PauseDialog>
    </>
  );
}
