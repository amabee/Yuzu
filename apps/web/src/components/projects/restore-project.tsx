"use client";
import { Button } from "@/components/ui/button";
import { useProjectAction } from "./use-project-action";

export function RestoreProject({ projectId }: { projectId: string }) {
  const restore = useProjectAction("restore");
  return (
    <>
      {restore.error && (
        <span role="alert" className="text-xs text-destructive">
          {restore.error.message}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={restore.isPending}
        onClick={() => restore.mutate({ projectId })}
      >
        Restore
      </Button>
    </>
  );
}
