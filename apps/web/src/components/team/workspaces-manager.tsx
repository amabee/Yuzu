"use client";
import { useState } from "react";
import { useRouter } from "nextjs-toploader/app";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import {
  workspacesStateSchema,
  type WorkspacesState,
} from "@/lib/admin-contract";
import {
  PauseButton,
  PauseClose,
  PauseDialog,
} from "@/components/pause/pause-dialog";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";

type Workspace = WorkspacesState["workspaces"][number];

/** Rename, archive and restore workspaces (owners and admins). */
export function WorkspacesManager({
  currentUserId,
}: {
  currentUserId: string;
}) {
  const client = useQueryClient();
  const router = useRouter();
  const key = ["principal", currentUserId, "admin", "workspaces"];
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [archiving, setArchiving] = useState<Workspace | null>(null);
  const [notice, setNotice] = useState<YuzuToastNotice | null>(null);
  const list = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      workspacesStateSchema.parse(
        (await apiRequest("/api/v1/admin/workspaces", { signal })).data,
      ),
  });
  const action = useMutation({
    mutationFn: (input: {
      action: "rename-workspace" | "archive-workspace" | "restore-workspace";
      body: Record<string, string>;
      done: string;
    }) =>
      apiRequest(`/api/v1/admin/${input.action}`, {
        method: "POST",
        json: input.body,
      }),
    onSuccess: (_, input) => {
      setEditing(null);
      setArchiving(null);
      setNotice({
        id: crypto.randomUUID(),
        kind: "success",
        message: input.done,
      });
      // The sidebar lists workspaces from the server.
      router.refresh();
    },
    onError: (error) =>
      setNotice({
        id: crypto.randomUUID(),
        kind: "error",
        title: "Couldn't update the workspace",
        message: error.message,
      }),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  if (list.isPending) return <p role="status">Loading workspaces…</p>;
  if (list.error) return <p role="alert">{list.error.message}</p>;
  const count = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  return (
    <>
      <YuzuToast notice={notice} />
      <ul className="people-admin-rows workspace-admin-rows">
        {list.data.workspaces.map((workspace) => (
          <li
            key={workspace.id}
            data-deactivated={Boolean(workspace.archivedAt)}
          >
            <div className="min-w-0">
              {editing?.id === workspace.id ? (
                <form
                  className="workspace-admin-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    action.mutate({
                      action: "rename-workspace",
                      body: { workspaceId: workspace.id, name: editing.name },
                      done: `Renamed to ${editing.name.trim()}.`,
                    });
                  }}
                >
                  <input
                    aria-label="Workspace name"
                    className="task-select"
                    autoFocus
                    maxLength={80}
                    required
                    value={editing.name}
                    onChange={(event) =>
                      setEditing({ ...editing, name: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setEditing(null);
                    }}
                  />
                  <PauseButton
                    tone="primary"
                    type="submit"
                    disabled={action.isPending}
                  >
                    Save
                  </PauseButton>
                  <PauseButton tone="text" onClick={() => setEditing(null)}>
                    Cancel
                  </PauseButton>
                </form>
              ) : (
                <>
                  <b>
                    {workspace.name}
                    {workspace.archivedAt && (
                      <span className="people-admin-tag">Archived</span>
                    )}
                  </b>
                  <small>
                    {count(workspace.boards, "board", "boards")} ·{" "}
                    {count(workspace.members, "member", "members")}
                  </small>
                </>
              )}
            </div>
            {editing?.id !== workspace.id && (
              <span className="workspace-admin-actions">
                {!workspace.archivedAt && (
                  <PauseButton
                    onClick={() =>
                      setEditing({ id: workspace.id, name: workspace.name })
                    }
                  >
                    Rename
                  </PauseButton>
                )}
                {workspace.archivedAt ? (
                  <PauseButton
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({
                        action: "restore-workspace",
                        body: { workspaceId: workspace.id },
                        done: `${workspace.name} is back.`,
                      })
                    }
                  >
                    Restore
                  </PauseButton>
                ) : (
                  <PauseButton onClick={() => setArchiving(workspace)}>
                    Archive
                  </PauseButton>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      <PauseDialog
        open={Boolean(archiving)}
        onOpenChange={(open) => !open && setArchiving(null)}
        intent="warning"
        title={`Archive ${archiving?.name ?? ""}?`}
        description="Its projects and boards are hidden from everyone until you restore it. Nothing is deleted."
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              data-autofocus
              disabled={action.isPending}
              onClick={() =>
                archiving &&
                action.mutate({
                  action: "archive-workspace",
                  body: { workspaceId: archiving.id },
                  done: `${archiving.name} is archived.`,
                })
              }
            >
              Archive workspace
            </PauseButton>
          </>
        }
      />
    </>
  );
}
