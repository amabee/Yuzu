"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "nextjs-toploader/app";
import { apiRequest } from "@/lib/api-client";
import { trashStateSchema, type TrashState } from "@/lib/trash-contract";
import {
  PauseButton,
  PauseClose,
  PauseDialog,
} from "@/components/pause/pause-dialog";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";
import { ago } from "@/components/team/people-manager";

type Tab = "records" | "boards" | "projects";
type Kind = "record" | "board" | "project";

/**
 * Trash: what this person may restore. With `boardId`, only that board's
 * records (the board's "Deleted" view); otherwise records, boards and
 * projects, plus erase tools for admins.
 */
export function TrashManager({
  currentUserId,
  boardId,
  onRestored,
}: {
  currentUserId: string;
  boardId?: string;
  onRestored?: () => void;
}) {
  const client = useQueryClient();
  const router = useRouter();
  const key = ["principal", currentUserId, "trash", boardId ?? "all"];
  const [tab, setTab] = useState<Tab>("records");
  const [notice, setNotice] = useState<YuzuToastNotice | null>(null);
  const [erasing, setErasing] = useState<
    { kind: Kind; id: string; name: string } | "all" | null
  >(null);
  const [typed, setTyped] = useState("");
  const trash = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      trashStateSchema.parse(
        (
          await apiRequest(
            `/api/v1/trash/list${boardId ? `?boardId=${boardId}` : ""}`,
            { signal },
          )
        ).data,
      ),
  });
  const done = (message: string) => {
    setNotice({ id: crypto.randomUUID(), kind: "success", message });
    void client.invalidateQueries({
      queryKey: ["principal", currentUserId, "trash"],
    });
    onRestored?.();
    router.refresh();
  };
  const fail = (error: Error) =>
    setNotice({
      id: crypto.randomUUID(),
      kind: "error",
      title: "Trash couldn't update",
      message: error.message,
    });
  const restore = useMutation({
    mutationFn: (input: { kind: Kind; id: string; withParents?: boolean }) =>
      apiRequest(`/api/v1/trash/restore-${input.kind}`, {
        method: "POST",
        json:
          input.kind === "record"
            ? { id: input.id, withParents: Boolean(input.withParents) }
            : { id: input.id },
      }),
    onSuccess: () => done("Restored."),
    onError: fail,
  });
  const erase = useMutation({
    mutationFn: async (input: { kind: Kind; id: string } | "all") => {
      let before: string | undefined;
      let remaining = true;
      while (remaining) {
        const response = await apiRequest<{
          before: string;
          remaining: boolean;
        }>("/api/v1/trash/erase", {
          method: "POST",
          json: {
            ...(input === "all"
              ? { all: true }
              : { kind: input.kind, id: input.id }),
            before,
          },
        });
        before = response.data.before;
        remaining = response.data.remaining;
      }
    },
    onSuccess: () => {
      setErasing(null);
      setTyped("");
      done("Erased for good.");
    },
    onError: fail,
  });
  const retention = useMutation({
    mutationFn: (days: string) =>
      apiRequest("/api/v1/trash/retention", {
        method: "POST",
        json: { days: days === "never" ? null : days },
      }),
    onSuccess: () => done("Auto-erase saved."),
    onError: fail,
  });
  if (trash.isPending) return <p role="status">Loading Trash…</p>;
  if (trash.error) return <p role="alert">{trash.error.message}</p>;
  const state: TrashState = trash.data;
  const total =
    state.records.length + state.boards.length + state.projects.length;
  const busy = restore.isPending || erase.isPending;
  const when = (item: { deletedAt: string; deletedBy: string | null }) =>
    `deleted ${item.deletedBy ? `by ${item.deletedBy}, ` : ""}${ago(item.deletedAt).toLowerCase()}`;
  const eraseButton = (kind: Kind, id: string, name: string) =>
    state.canErase && (
      <PauseButton
        tone="text"
        className="trash-erase"
        disabled={busy}
        onClick={() => setErasing({ kind, id, name })}
      >
        Erase
      </PauseButton>
    );
  const shownTab: Tab = boardId ? "records" : tab;
  return (
    <section className="trash" aria-label="Trash">
      <YuzuToast notice={notice} />
      {!boardId && (
        <div className="people-admin-tabs" role="group" aria-label="Show">
          {(
            [
              ["records", `Records ${state.records.length}`],
              ["boards", `Boards ${state.boards.length}`],
              ["projects", `Projects ${state.projects.length}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <ul className="people-admin-rows trash-rows">
        {shownTab === "records" &&
          state.records.map((item) => (
            <li key={item.id}>
              <div className="min-w-0">
                <b>{item.name}</b>
                <small>
                  {item.recordName} ·{" "}
                  {item.projectName ? `${item.projectName} / ` : ""}
                  {item.boardName} · {when(item)}
                </small>
              </div>
              <span className="trash-meta">
                {item.parentDeleted
                  ? "Its board is in Trash too"
                  : `${item.comments} comments · ${item.files} files`}
              </span>
              <span className="trash-actions">
                <PauseButton
                  disabled={busy}
                  aria-label={`Restore ${item.name}`}
                  onClick={() =>
                    restore.mutate({
                      kind: "record",
                      id: item.id,
                      withParents: item.parentDeleted,
                    })
                  }
                >
                  {item.parentDeleted ? "Restore both" : "Restore"}
                </PauseButton>
                {eraseButton("record", item.id, item.name)}
              </span>
            </li>
          ))}
        {shownTab === "boards" &&
          state.boards.map((item) => (
            <li key={item.id}>
              <div className="min-w-0">
                <b>{item.name}</b>
                <small>
                  Board · {item.workspaceName}
                  {item.projectName ? ` / ${item.projectName}` : ""} ·{" "}
                  {when(item)}
                </small>
              </div>
              <span className="trash-meta">
                {item.parentDeleted
                  ? "Its project is in Trash; restore that first"
                  : `${item.records} records`}
              </span>
              <span className="trash-actions">
                <PauseButton
                  disabled={busy || item.parentDeleted}
                  aria-label={`Restore ${item.name}`}
                  onClick={() => restore.mutate({ kind: "board", id: item.id })}
                >
                  Restore
                </PauseButton>
                {eraseButton("board", item.id, item.name)}
              </span>
            </li>
          ))}
        {shownTab === "projects" &&
          state.projects.map((item) => (
            <li key={item.id}>
              <div className="min-w-0">
                <b>{item.name}</b>
                <small>
                  Project · {item.workspaceName} · {when(item)}
                </small>
              </div>
              <span className="trash-meta">{item.boards} boards</span>
              <span className="trash-actions">
                <PauseButton
                  disabled={busy}
                  aria-label={`Restore ${item.name}`}
                  onClick={() =>
                    restore.mutate({ kind: "project", id: item.id })
                  }
                >
                  Restore
                </PauseButton>
                {eraseButton("project", item.id, item.name)}
              </span>
            </li>
          ))}
        {!state[shownTab].length && (
          <li className="people-admin-empty">
            {boardId
              ? "Nothing from this board is in Trash."
              : "Nothing here. Deleted items wait here until someone restores them."}
          </li>
        )}
      </ul>

      {state.canErase && !boardId && (
        <div className="trash-retain">
          <label>
            <b>Erase items deleted more than</b>
            <select
              aria-label="Auto-erase Trash"
              className="task-select project-role-select"
              value={
                state.retentionDays ? String(state.retentionDays) : "never"
              }
              disabled={retention.isPending}
              onChange={(event) => retention.mutate(event.target.value)}
            >
              <option value="never">Never</option>
              <option value="30">30 days ago</option>
              <option value="90">90 days ago</option>
              <option value="365">1 year ago</option>
            </select>
          </label>
          <PauseButton
            className="trash-empty"
            disabled={busy || total === 0}
            onClick={() => setErasing("all")}
          >
            Empty Trash…
          </PauseButton>
        </div>
      )}

      <PauseDialog
        open={Boolean(erasing)}
        onOpenChange={(open) => {
          if (!open) {
            setErasing(null);
            setTyped("");
          }
        }}
        intent="danger"
        title={
          erasing === "all"
            ? `Erase ${total} ${total === 1 ? "item" : "items"} for good?`
            : `Erase “${erasing?.name ?? ""}” for good?`
        }
        description="This removes them with their comments, history and files. It can't be undone."
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              disabled={
                erase.isPending || (erasing === "all" && typed !== "erase")
              }
              onClick={() => erasing && erase.mutate(erasing)}
            >
              Erase for good
            </PauseButton>
          </>
        }
      >
        {erasing === "all" && (
          <label className="task-field-label">
            Type “erase” to confirm
            <input
              className="task-select"
              aria-label="Type erase to confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value.trim())}
            />
          </label>
        )}
      </PauseDialog>
    </section>
  );
}
