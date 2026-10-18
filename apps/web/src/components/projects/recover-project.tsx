"use client";
import { useState } from "react";
import { useRouter } from "nextjs-toploader/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Recover access to {project.name}?</DialogTitle>
          <DialogDescription>
            You&apos;ll become a manager and see all of its boards. Its current
            managers get an email, and the recovery is recorded in the access
            log. Type the project name to confirm.
          </DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              recover.mutate({ projectId: project.id, confirmName });
            }}
          >
            <Input
              aria-label="Project name to confirm"
              autoComplete="off"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
            />
            {recover.error && (
              <p role="alert" className="text-sm text-destructive">
                {recover.error.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                disabled={confirmName !== project.name || recover.isPending}
              >
                {recover.isPending ? "Recovering…" : "Recover access"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
