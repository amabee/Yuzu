"use client";
import { useState, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import {
  commentsSchema,
  commentHistorySchema,
  type BoardState,
  type BoardTask,
} from "@/lib/board-contract";
import { mentionPresent, activeMention } from "@/lib/comment-mentions";
import { Button } from "@/components/ui/button";
import { AssigneeAvatars } from "./board-presentation";
import { History, Pencil, SendHorizontal, Trash2, X } from "lucide-react";
type Person = { id: string; name: string; deactivated?: boolean };
function Composer({
  people,
  body,
  setBody,
  ids,
  setIds,
  disabled,
  label,
  pinned = false,
  placeholder,
}: {
  people: Person[];
  body: string;
  setBody: (body: string) => void;
  ids: string[];
  setIds: (ids: string[]) => void;
  disabled: boolean;
  label: string;
  /** The one-line reply box pinned to the bottom of the task panel. */
  pinned?: boolean;
  placeholder?: string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [trigger, setTrigger] =
    useState<ReturnType<typeof activeMention>>(null);
  const [highlight, setHighlight] = useState(0);
  const dismissed = useRef("");
  const matches = trigger
    ? people
        .filter((person) => !person.deactivated)
        .filter((person) =>
          person.name
            .toLocaleLowerCase()
            .includes(trigger.query.trim().toLocaleLowerCase()),
        )
        .slice(0, 8)
    : [];
  const updateTrigger = (value: string, caret: number, end = caret) => {
    if (
      disabled ||
      caret !== end ||
      dismissed.current === `${value}\0${caret}`
    ) {
      setTrigger(null);
      return;
    }
    setTrigger(
      activeMention(
        value,
        caret,
        people
          .filter((person) => ids.includes(person.id))
          .map((person) => person.name),
      ),
    );
    setHighlight(0);
  };
  const choose = (person: Person) => {
    if (!trigger || !textarea.current) return;
    const caret = textarea.current.selectionStart;
    const insertion = `@${person.name}${/^\s/.test(body.slice(caret)) ? "" : " "}`;
    const next = body.slice(0, trigger.start) + insertion + body.slice(caret);
    if (next.length > 5000) return;
    const position = trigger.start + insertion.length;
    dismissed.current = `${next}\0${position}`;
    setBody(next);
    setIds([...new Set([...ids, person.id])]);
    setTrigger(null);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(position, position);
    });
  };
  return (
    <div className="space-y-3">
      <label className="task-field-label">
        <span className={pinned ? "sr-only" : undefined}>{label}</span>
        <div className="relative">
          <textarea
            ref={textarea}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-controls={trigger ? listId : undefined}
            aria-activedescendant={
              trigger && matches[highlight]
                ? `${listId}-${highlight}`
                : undefined
            }
            className="task-textarea"
            aria-label={label}
            placeholder={placeholder}
            maxLength={5000}
            rows={pinned ? 1 : 3}
            required
            value={body}
            disabled={disabled}
            onSelect={(event) =>
              updateTrigger(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
                event.currentTarget.selectionEnd,
              )
            }
            onBlur={() => setTrigger(null)}
            onCompositionStart={() => setTrigger(null)}
            onCompositionEnd={(event) =>
              updateTrigger(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
              )
            }
            onKeyDown={(event) => {
              if (!trigger || event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                dismissed.current = `${body}\0${event.currentTarget.selectionStart}`;
                setTrigger(null);
              } else if (
                matches.length &&
                ["ArrowDown", "ArrowUp"].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  (highlight +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    matches.length) %
                  matches.length;
                setHighlight(next);
                requestAnimationFrame(() =>
                  document
                    .getElementById(`${listId}-${next}`)
                    ?.scrollIntoView({ block: "nearest" }),
                );
              } else if (
                matches.length &&
                ["Enter", "Tab"].includes(event.key)
              ) {
                event.preventDefault();
                choose(matches[highlight] ?? matches[0]!);
              }
            }}
            onChange={(event) => {
              dismissed.current = "";
              updateTrigger(event.target.value, event.target.selectionStart);
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
          {trigger && !disabled && (
            <div
              id={listId}
              role="listbox"
              aria-label="Mention suggestions"
              className="absolute right-0 bottom-full left-0 z-40 mb-2 max-h-48 overflow-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
            >
              {matches.map((person, index) => (
                <button
                  key={person.id}
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-label={person.name}
                  aria-selected={index === highlight}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${index === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent"}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(person)}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs text-secondary-foreground">
                    {person.name.charAt(0)}
                  </span>
                  <span className="min-w-0 break-words">{person.name}</span>
                </button>
              ))}
              {!matches.length && (
                <p
                  role="status"
                  className="px-3 py-2 text-sm text-muted-foreground"
                >
                  No teammates match that name.
                </p>
              )}
            </div>
          )}
        </div>
      </label>
      {ids.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
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
      )}
      <p className="text-xs text-muted-foreground">
        Type @ and a name to mention a teammate.
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
  composerTarget,
}: {
  state: BoardState;
  task: BoardTask;
  active: boolean;
  syncInterval: number;
  onNotice: (message: string, kind: "success" | "error") => void;
  /** Where the reply box renders; the task panel pins it to its footer. */
  composerTarget?: HTMLElement | null;
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
  const composer = (
    <form
      className={composerTarget ? "task-composer" : undefined}
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
        pinned={Boolean(composerTarget)}
        placeholder={composerTarget ? "Reply or mention someone…" : undefined}
      />
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      {composerTarget ? (
        <Button
          size="icon"
          aria-label="Post comment"
          title="Post comment"
          disabled={!body.trim() || mutation.isPending}
          className="task-composer-send"
        >
          <SendHorizontal size={16} />
        </Button>
      ) : (
        <Button disabled={!body.trim() || mutation.isPending} className="mt-3">
          {mutation.isPending ? "Saving…" : "Post comment"}
        </Button>
      )}
    </form>
  );
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
      {!task.archivedAt &&
        (composerTarget
          ? active && createPortal(composer, composerTarget)
          : composer)}
      {task.archivedAt && (
        <p className="text-sm text-muted-foreground">
          Archived tasks are read-only.
        </p>
      )}
    </section>
  );
}
