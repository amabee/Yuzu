"use client";
import {
  RecordFieldsEditor,
  RecordTypePicker,
  type RecordDraft,
} from "./record-settings";
import type { RecordType } from "@/lib/record-types";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "nextjs-toploader/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PauseButton,
  PauseClose,
  PauseModal,
} from "@/components/pause/pause-dialog";
import { apiRequest } from "@/lib/api-client";
export function CreateBoard({
  workspaces,
  project,
}: {
  workspaces: { id: string; name: string }[];
  /** Create inside this project; its workspace is implied. */
  project?: { id: string; name: string };
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [recordType, setRecordType] = useState<RecordType>("TASK");
  const [record, setRecord] = useState<RecordDraft>({});
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const router = useRouter();
  const selectedWorkspace =
    workspaces.find((item) => item.id === workspaceId) ?? workspaces[0];
  const mutation = useMutation({
    mutationFn: async () =>
      (
        await apiRequest<{ id: string }>("/api/v1/boards/create-board", {
          method: "POST",
          json: {
            ...(project
              ? { projectId: project.id }
              : { workspaceId: selectedWorkspace?.id }),
            name,
            recordType,
            ...(recordType === "CUSTOM" ? { record } : {}),
          },
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
      <Button
        disabled={!project && !workspaces.length}
        onClick={() => setOpen(true)}
      >
        {project ? "New board" : "Create board"}
      </Button>
      <PauseModal
        open={open}
        onOpenChange={setOpen}
        title={project ? `New board in ${project.name}` : "Create board"}
        description="Choose what the board holds. You can rename fields and turn them off later."
        as="form"
        footer={
          recordType === "DEAL"
            ? "Deals start with stages Lead → Qualified → Proposal → Negotiation → Won / Lost, plus Amount and Probability."
            : recordType === "TASK"
              ? "Boards start with To do, In progress and Done."
              : "Custom boards start with To do, In progress and Done statuses if Status is on."
        }
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              type="submit"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Creating…" : "Create board"}
            </PauseButton>
          </>
        }
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <RecordTypePicker value={recordType} onChange={setRecordType} />
        {recordType === "CUSTOM" && (
          <RecordFieldsEditor
            type="CUSTOM"
            value={record}
            onChange={setRecord}
          />
        )}
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
        {project ? (
          <p className="text-sm text-muted-foreground">In {project.name}</p>
        ) : (
          <label className="task-field-label">
            Workspace
            <select
              aria-label="Board workspace"
              className="task-select"
              value={selectedWorkspace?.id ?? ""}
              onChange={(event) => setWorkspaceId(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {mutation.error && (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        )}
      </PauseModal>
    </>
  );
}
