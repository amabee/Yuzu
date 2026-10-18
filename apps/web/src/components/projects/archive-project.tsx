"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "nextjs-toploader/app";
import {
  PauseButton,
  PauseClose,
  PauseDialog,
} from "@/components/pause/pause-dialog";
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
      <PauseDialog
        open={Boolean(project)}
        onOpenChange={onOpenChange}
        intent="warning"
        title={`Archive ${project?.name ?? "project"}?`}
        description="Its boards will be hidden and read-only until you restore it. Nothing is deleted."
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              data-autofocus
              disabled={archive.isPending}
              onClick={() =>
                project && archive.mutate({ projectId: project.id })
              }
            >
              {archive.isPending ? "Archiving…" : "Archive project"}
            </PauseButton>
          </>
        }
      >
        {archive.error && (
          <p role="alert" className="text-sm text-destructive">
            {archive.error.message}
          </p>
        )}
      </PauseDialog>
      <YuzuToast notice={notice} />
    </>
  );
}
