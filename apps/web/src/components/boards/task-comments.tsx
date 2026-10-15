"use client";
import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import {
  commentsSchema,
  commentHistorySchema,
  type BoardState,
  type BoardTask,
} from "@/lib/board-contract";
import { mentionPresent } from "@/lib/comment-mentions";
import { Button } from "@/components/ui/button";
import { AssigneeAvatars } from "./board-presentation";
import { AtSign, History, Pencil, Trash2, X } from "lucide-react";
type Person = { id: string; name: string };
function Composer({
  people,
  body,
  setBody,
  ids,
  setIds,
  disabled,
  label,
}: {
  people: Person[];
  body: string;
  setBody: (body: string) => void;
  ids: string[];
  setIds: (ids: string[]) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="space-y-3">
      <label className="task-field-label">
        {label}
        <textarea
          className="task-textarea"
          aria-label={label}
          maxLength={5000}
          rows={3}
          required
          value={body}
          disabled={disabled}
          onChange={(event) => {
            setBody(event.target.value);
            setIds(
              ids.filter((id) => {
                const person = people.find((person) => person.id === id);
                return (
                  person && mentionPresent(event.target.value, person.name)
                );
              }),
            );
          }}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <AtSign size={14} className="text-primary" />
        <select
          aria-label={`Mention teammate: ${label}`}
          className="max-w-full rounded-lg border bg-background px-2 py-1 text-xs"
          value=""
          disabled={disabled}
          onChange={(event) => {
            const person = people.find(
              (person) => person.id === event.target.value,
            );
            if (!person) return;
            setBody(
              `${body}${body && !/\s$/.test(body) ? " " : ""}@${person.name} `,
            );
            setIds([...ids, person.id]);
          }}
        >
          <option value="">Mention a teammate</option>
          {people
            .filter((person) => !ids.includes(person.id))
            .map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
        </select>
        {ids.map((id) => (
          <button
            type="button"
            key={id}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground"
            aria-label={`Stop notifying ${people.find((person) => person.id === id)?.name ?? "unavailable teammate"}`}
            onClick={() => setIds(ids.filter((personId) => personId !== id))}
          >
            {people.find((person) => person.id === id)?.name ??
              "Unavailable teammate"}
            <X size={11} />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Choose a teammate to notify them when you post or save.
      </p>
    </div>
  );
}
function CommentHistory({ id, queryKey }: { id: string; queryKey: string[] }) {
  const query = useQuery({
    queryKey: [...queryKey, "history", id],
    queryFn: async ({ signal }) =>
      commentHistorySchema.parse(
        (
          await apiRequest(`/api/v1/boards/comment-history?commentId=${id}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      ),
    staleTime: 0,
  });
  return (
    <div
      className="mt-3 space-y-3 rounded-lg border p-3"
      aria-label="Comment edit history"
    >
      {query.isPending && <p role="status">Loading history…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {query.data?.map((row) => (
        <div
          key={row.revision}
          className="border-b pb-3 last:border-0 last:pb-0"
        >
          <span className="text-xs text-muted-foreground">
            Version {row.revision} · {row.action} by {row.actorName}
          </span>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">
            {row.body}
          </p>
        </div>
      ))}
      {query.data?.length === 50 && (
        <p className="text-xs text-muted-foreground">
          Showing the latest 50 versions.
        </p>
      )}
    </div>
  );
}
export function TaskComments({
  state,
  task,
  active,
  onNotice,
  syncInterval,
}: {
  state: BoardState;
  task: BoardTask;
  active: boolean;
  syncInterval: number;
  onNotice: (message: string, kind: "success" | "error") => void;
}) {
  const [body, setBody] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [edit, setEdit] = useState<{
    id: string;
    revision: number;
    body: string;
    ids: string[];
  } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const createKey = useRef(crypto.randomUUID());
  const queryClient = useQueryClient();
  const queryKey = ["principal", state.currentUserId, "task-comments", task.id];
  const query = useQuery({
    queryKey,
    enabled: active,
    staleTime: 0,
    refetchInterval: syncInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async ({ signal }) =>
      commentsSchema.parse(
        (
          await apiRequest(`/api/v1/boards/comments?taskId=${task.id}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      ),
  });
  const mutation = useMutation({
    mutationKey: queryKey,
    mutationFn: async (
      input:
        | { action: "create"; body: string; mentionIds: string[] }
        | {
            action: "edit";
            commentId: string;
            revision: number;
            body: string;
            mentionIds: string[];
          }
        | { action: "remove"; commentId: string; revision: number },
    ) => {
      if (input.action === "create")
        return apiRequest("/api/v1/boards/comment", {
          method: "POST",
          json: {
            taskId: task.id,
            createKey: createKey.current,
            body: input.body,
            mentionIds: input.mentionIds,
          },
        });
      return apiRequest("/api/v1/boards/change-comment", {
        method: "POST",
        json: input,
      });
    },
    onSuccess: async (_, input) => {
      if (input.action === "create") {
        setBody("");
        setIds([]);
        createKey.current = crypto.randomUUID();
      } else {
        setEdit(null);
        setRemoving(null);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({
          queryKey: ["principal", state.currentUserId, "boards", state.boardId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["principal", state.currentUserId, "notifications"],
        }),
      ]);
      onNotice(
        input.action === "create"
          ? "Comment added"
          : input.action === "edit"
            ? "Comment updated"
            : "Comment removed",
        "success",
      );
    },
    onError: async (error) => {
      onNotice(error.message, "error");
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const startEdit = (comment: NonNullable<typeof query.data>[number]) => {
    setRemoving(null);
    setEdit({
      id: comment.id,
      revision: comment.revision,
      body: comment.body,
      ids: comment.mentions.map((person) => person.id),
    });
  };
  return (
    <section
      hidden={!active}
      className="task-comments-panel"
      aria-label="Task comments"
    >
      <h3>
        Comments <span>{task.commentCount ?? 0}</span>
      </h3>
      {query.isLoading && <p role="status">Loading comments…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {!query.isLoading && !query.error && !query.data?.length && (
        <p className="text-sm text-muted-foreground">
          No comments yet. Start the conversation.
        </p>
      )}
      {(task.commentCount ?? 0) > 100 && (
        <p className="text-xs text-muted-foreground">
          Showing the latest 100 comments.
        </p>
      )}
      <ul className="task-comment-list">
        {query.data?.map((comment) => (
          <li key={comment.id} data-comment-id={comment.id}>
            <div className="flex flex-wrap items-center gap-2">
              <AssigneeAvatars
                ids={[comment.authorId]}
                people={[
                  ...state.people,
                  { id: comment.authorId, name: comment.authorName },
                ]}
              />
              <b>{comment.authorName}</b>
              <time dateTime={comment.createdAt}>
                {new Date(comment.createdAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "UTC",
                })}{" "}
                UTC
              </time>
              {comment.revision > 1 && !comment.deletedAt && (
                <span className="text-xs text-muted-foreground">Edited</span>
              )}
            </div>
            {comment.deletedAt ? (
              <p className="italic text-muted-foreground">Comment removed</p>
            ) : edit?.id === comment.id ? (
              <form
                className="mt-3 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  mutation.mutate({
                    action: "edit",
                    commentId: edit.id,
                    revision: edit.revision,
                    body: edit.body,
                    mentionIds: edit.ids,
                  });
                }}
              >
                <Composer
                  label="Edit comment"
                  people={state.people}
                  body={edit.body}
                  setBody={(body) => setEdit({ ...edit, body })}
                  ids={edit.ids}
                  setIds={(ids) =>
                    setEdit((current) => (current ? { ...current, ids } : null))
                  }
                  disabled={mutation.isPending || Boolean(task.archivedAt)}
                />
                {edit.revision !== comment.revision && (
                  <div role="alert" className="text-sm text-destructive">
                    This comment changed while you were editing.
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2"
                      onClick={() => startEdit(comment)}
                    >
                      Load latest comment
                    </Button>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    disabled={
                      mutation.isPending ||
                      Boolean(task.archivedAt) ||
                      !edit.body.trim() ||
                      edit.revision !== comment.revision
                    }
                  >
                    Save comment
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={mutation.isPending}
                    onClick={() => setEdit(null)}
                  >
                    Cancel edit
                  </Button>
                </div>
              </form>
            ) : (
              <p>{comment.body}</p>
            )}
            {!comment.deletedAt && (
              <div className="mt-3 flex flex-wrap gap-2">
                {!task.archivedAt && comment.canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={mutation.isPending}
                    onClick={() => startEdit(comment)}
                  >
                    <Pencil size={12} />
                    Edit
                  </Button>
                )}
                {!task.archivedAt && comment.canRemove && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={mutation.isPending}
                    onClick={() => setRemoving(comment.id)}
                  >
                    <Trash2 size={12} />
                    Remove
                  </Button>
                )}
                {comment.revision > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setHistory(history === comment.id ? null : comment.id)
                    }
                  >
                    <History size={12} />
                    {history === comment.id ? "Hide history" : "History"}
                  </Button>
                )}
              </div>
            )}
            {removing === comment.id && !comment.deletedAt && (
              <div className="mt-3 rounded-lg border p-3">
                <p className="text-sm">
                  Remove this comment? Its content will be hidden and a removal
                  record will remain.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        action: "remove",
                        commentId: comment.id,
                        revision: comment.revision,
                      })
                    }
                  >
                    Remove comment
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={mutation.isPending}
                    onClick={() => setRemoving(null)}
                  >
                    Keep comment
                  </Button>
                </div>
              </div>
            )}
            {history === comment.id && !comment.deletedAt && (
              <CommentHistory id={comment.id} queryKey={queryKey} />
            )}
          </li>
        ))}
      </ul>
      {!task.archivedAt && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim() && !mutation.isPending)
              mutation.mutate({ action: "create", body, mentionIds: ids });
          }}
        >
          <Composer
            label="New comment"
            people={state.people}
            body={body}
            setBody={(body) => {
              setBody(body);
              createKey.current = crypto.randomUUID();
            }}
            ids={ids}
            setIds={(ids) => {
              setIds(ids);
              createKey.current = crypto.randomUUID();
            }}
            disabled={mutation.isPending}
          />
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <Button
            disabled={!body.trim() || mutation.isPending}
            className="mt-3"
          >
            {mutation.isPending ? "Saving…" : "Post comment"}
          </Button>
        </form>
      )}
      {task.archivedAt && (
        <p className="text-sm text-muted-foreground">
          Archived tasks are read-only.
        </p>
      )}
    </section>
  );
}
