"use client";
import { useState } from "react";
import { useRouter } from "nextjs-toploader/app";
import { Input } from "@/components/ui/input";
import {
  PauseButton,
  PauseClose,
  PauseModal,
} from "@/components/pause/pause-dialog";
import { ColorSwatches, VisibilityChoice } from "./project-form-fields";
import { useProjectAction } from "./use-project-action";

export function CreateProjectSheet({
  open,
  onOpenChange,
  workspaces,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("teal");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const workspace =
    workspaces.find((item) => item.id === workspaceId) ?? workspaces[0];
  const create = useProjectAction<{ id: string }>("create", (project) => {
    onOpenChange(false);
    setName("");
    router.push(`/projects/${project.id}`);
  });
  return (
    <PauseModal
      open={open}
      onOpenChange={onOpenChange}
      title="Create a project"
      description="Projects keep related boards together. You'll manage it, and can add people afterwards."
      as="form"
      footer="You can change this later."
      actions={
        <>
          <PauseClose asChild>
            <PauseButton>Cancel</PauseButton>
          </PauseClose>
          <PauseButton
            tone="primary"
            type="submit"
            disabled={create.isPending || !workspace}
          >
            {create.isPending ? "Creating…" : "Create project"}
          </PauseButton>
        </>
      }
      onSubmit={(event) => {
        event.preventDefault();
        // Always send a listed workspace, never stale or empty state.
        if (workspace)
          create.mutate({
            workspaceId: workspace.id,
            name,
            color,
            visibility,
          });
      }}
    >
      <label className="task-field-label">
        Project name
        <Input
          aria-label="Project name"
          required
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {workspaces.length > 1 && (
        <label className="task-field-label">
          Workspace
          <select
            aria-label="Project workspace"
            className="task-select"
            value={workspace?.id ?? ""}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="task-field-label">
        Color
        <ColorSwatches value={color} onChange={setColor} />
      </div>
      <VisibilityChoice
        value={visibility}
        onChange={setVisibility}
        workspaceName={workspace?.name ?? "this workspace"}
      />
      {create.error && (
        <p role="alert" className="text-sm text-destructive">
          {create.error.message}
        </p>
      )}
    </PauseModal>
  );
}
