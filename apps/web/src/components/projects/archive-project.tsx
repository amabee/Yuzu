"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "nextjs-toploader/app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";
import { useProjectAction } from "./use-project-action";

export function ArchiveProjectDialog({
  project,
  onOpenChange,
}: {
  project: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [notice, setNotice] = useState<YuzuToastNotice | null>(null);
  const restore = useProjectAction<unknown, { projectId: string }>(
    "restore",
    () =>
      setNotice({
        id: crypto.randomUUID(),
        kind: "success",
        message: "Project restored",
      }),
  );
  const archive = useProjectAction<unknown, { projectId: string }>(
    "archive",
    (_, { projectId }) => {
      onOpenChange(false);
      if (pathname === `/projects/${projectId}`) router.push("/");
      setNotice({
        id: crypto.randomUUID(),
        kind: "success",
        message: "Project archived",
        action: {
          label: "Restore",
          altText: "Restore the archived project",
          onClick: () => restore.mutate({ projectId }),
        },
      });
    },
  );
  return (
    <>
      <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Archive {project?.name}?</DialogTitle>
          <DialogDescription>
            Its boards will be hidden and read-only until you restore it.
            Nothing is deleted.
          </DialogDescription>
          {archive.error && (
            <p role="alert" className="text-sm text-destructive">
              {archive.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={archive.isPending}
              onClick={() =>
                project && archive.mutate({ projectId: project.id })
              }
            >
              {archive.isPending ? "Archiving…" : "Archive project"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <YuzuToast notice={notice} />
    </>
  );
}
