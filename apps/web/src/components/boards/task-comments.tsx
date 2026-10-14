"use client";
import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import {
  commentsSchema,
  type BoardState,
  type BoardTask,
} from "@/lib/board-contract";
import { Button } from "@/components/ui/button";
import { AssigneeAvatars } from "./board-presentation";
export function TaskComments({
  state,
  task,
  active,
  onNotice,
}: {
  state: BoardState;
  task: BoardTask;
  active: boolean;
  onNotice: (message: string, kind: "success" | "error") => void;
}) {
  const [body, setBody] = useState("");
  const createKey = useRef(crypto.randomUUID());
  const queryClient = useQueryClient();
  const queryKey = ["principal", state.currentUserId, "task-comments", task.id];
  const query = useQuery({
    queryKey,
    enabled: active,
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
    mutationFn: () =>
      apiRequest("/api/v1/boards/comment", {
        method: "POST",
        json: { taskId: task.id, createKey: createKey.current, body },
      }),
    onSuccess: async () => {
      setBody("");
      createKey.current = crypto.randomUUID();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({
          queryKey: ["principal", state.currentUserId, "boards", state.boardId],
        }),
      ]);
      onNotice("Comment added", "success");
    },
    onError: (error) => onNotice(error.message, "error"),
  });
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
          <li key={comment.id}>
            <div className="flex items-center gap-2">
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
            </div>
            <p>{comment.body}</p>
          </li>
        ))}
      </ul>
      {!task.archivedAt && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim() && !mutation.isPending) mutation.mutate();
          }}
        >
          <label className="task-field-label">
            Add a comment
            <textarea
              className="task-textarea"
              aria-label="New comment"
              maxLength={5000}
              rows={3}
              required
              value={body}
              disabled={mutation.isPending}
              onChange={(event) => {
                setBody(event.target.value);
                createKey.current = crypto.randomUUID();
              }}
            />
          </label>
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <Button
            disabled={!body.trim() || mutation.isPending}
            className="mt-3"
          >
            {mutation.isPending ? "Posting…" : "Post comment"}
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
