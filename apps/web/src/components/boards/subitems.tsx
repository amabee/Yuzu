"use client";
import Link from "next/link";
import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createRecordId } from "@yuzu/database/ids";
import { apiRequest } from "@/lib/api-client";
import type { BoardState, BoardTask } from "@/lib/board-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AssigneeAvatars, formatDueDate } from "./board-presentation";
import {
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Plus,
} from "lucide-react";

type ChildPage = {
  summary: { total: number; done: number };
  outsideParentDates: boolean;
  items: BoardTask[];
  total: number;
  done: number;
  readOnly: boolean;
  nextCursor: string | null;
};
export function Subitems({
  state,
  parent,
  onOpen,
  compact = false,
}: {
  state: BoardState;
  parent: BoardTask;
  onOpen: (id: string) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(!compact);
  const [archived, setArchived] = useState(false);
  const [name, setName] = useState("");
  const [createKey, setCreateKey] = useState(() => createRecordId());
  const [notice, setNotice] = useState<{
    message: string;
    pending: boolean;
  } | null>(null);
  const client = useQueryClient();
  const key = ["principal", state.currentUserId, "boards", state.boardId];
  const query = useInfiniteQuery({
    queryKey: [...key, "subitems", parent.id, archived],
    initialPageParam: null as string | null,
    enabled: expanded,
    queryFn: async ({ pageParam, signal }) =>
      (
        await apiRequest<ChildPage>(
          `/api/v1/boards/subitems?${new URLSearchParams({ boardId: state.boardId, parentId: parent.id, archived: String(archived), ...(pageParam ? { cursor: pageParam } : {}) })}`,
          { signal, cache: "no-store" },
        )
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15000,
  });
  const children = query.data?.pages.flatMap((p) => p.items) ?? [];
  const summary = query.data?.pages[0]?.summary ?? parent.childSummary;
  const writable =
    parent.canEdit &&
    !parent.archivedAt &&
    !state.readOnly &&
    !query.data?.pages[0]?.readOnly;
  const mutation = useMutation({
    mutationKey: key,
    mutationFn: async ({ action, json }: { action: string; json: unknown }) =>
      (
        await apiRequest<{ outcome?: string }>(`/api/v1/boards/${action}`, {
          method: "POST",
          json,
        })
      ).data,
    onSuccess: (result, variables) => {
      if (variables.action === "create-task") {
        setName("");
        setCreateKey(createRecordId());
        setNotice({
          pending: result.outcome === "PENDING_APPROVAL",
          message:
            result.outcome === "PENDING_APPROVAL"
              ? "Subitem sent for approval."
              : "Subitem added.",
        });
      }
      void client.invalidateQueries({ queryKey: key });
    },
  });
  const move = (index: number, direction: number) => {
    const copy = [...children];
    const [item] = copy.splice(index, 1);
    if (!item) return;
    const target = index + direction;
    copy.splice(target, 0, item);
    mutation.mutate({
      action: "reorder-subitem",
      json: {
        taskId: item.id,
        afterId: copy[target - 1]?.id ?? null,
        beforeId: copy[target + 1]?.id ?? null,
      },
    });
  };
  const outside =
    query.data?.pages[0]?.outsideParentDates ||
    children.some(
      (c) =>
        (parent.startDate && c.startDate && c.startDate < parent.startDate) ||
        (parent.dueDate && c.dueDate && c.dueDate > parent.dueDate),
    );
  return (
    <section className="subitems" aria-label={`Subitems of ${parent.name}`}>
      <div className="subitems-heading">
        <button
          type="button"
          className="subitems-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <strong>Subitems</strong>
          <span>
            {summary?.total
              ? state.fields
                  .find((f) => f.key === "status")
                  ?.options.some((o) => o.id === "done")
                ? `${summary.done}/${summary.total}`
                : `${summary.total} subitems`
              : ""}
          </span>
        </button>
        {expanded && (
          <label className="text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />{" "}
            Archived
          </label>
        )}
      </div>
      {expanded && (
        <>
          {parent.archivedAt && (
            <p className="subitems-advisory">
              Read only while the parent is archived. Independent subitem
              archives are preserved.
            </p>
          )}
          {summary?.total &&
          !state.fields
            .find((f) => f.key === "status")
            ?.options.some((o) => o.id === "done") ? (
            <p className="subitems-advisory">No Done status is configured.</p>
          ) : null}
          {outside && (
            <p className="subitems-advisory">
              Some subitem dates extend beyond this task. Dates remain
              independent.
            </p>
          )}
          {parent.statusId === "done" &&
            summary &&
            summary.done < summary.total && (
              <p className="subitems-advisory">
                This task is complete with unfinished subitems.
              </p>
            )}
          {children.map((child, index) => (
            <div
              className="subitem-row"
              key={child.id}
              data-subitem-id={child.id}
            >
              <button
                type="button"
                className="subitem-open"
                onClick={() => onOpen(child.id)}
              >
                <span
                  className="subitem-status"
                  data-done={child.statusId === "done"}
                >
                  {child.statusId === "done" ? "✓" : "○"}
                </span>
                <span>{child.name}</span>
              </button>
              <span className="subitem-date">
                {child.dueDate ? formatDueDate(child.dueDate) : ""}
              </span>
              <AssigneeAvatars ids={child.assigneeIds} people={state.people} />
              {writable && !archived && (
                <span className="subitem-order">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Move ${child.name} up`}
                    disabled={mutation.isPending || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={13} />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Move ${child.name} down`}
                    disabled={
                      mutation.isPending ||
                      index === children.length - 1 ||
                      query.hasNextPage
                    }
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={13} />
                  </Button>
                </span>
              )}
            </div>
          ))}
          {query.isPending && (
            <p className="subitems-advisory">Loading subitems…</p>
          )}
          {!query.isPending && !children.length && (
            <p className="subitems-advisory">
              {archived
                ? "No independently archived subitems."
                : "Break this task into pieces with their own people, dates and progress."}
            </p>
          )}
          {query.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              Load more subitems
            </Button>
          )}
          {writable && !archived && (
            <form
              className="subitem-create"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim())
                  mutation.mutate({
                    action: "create-task",
                    json: {
                      boardId: state.boardId,
                      parentId: parent.id,
                      createKey,
                      name: name.trim(),
                    },
                  });
              }}
            >
              <Input
                aria-label="Subitem name"
                placeholder="Add a subitem…"
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Add subitem"
                disabled={mutation.isPending || !name.trim()}
              >
                <Plus size={16} />
              </Button>
            </form>
          )}
          {query.error && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                client.resetQueries({
                  queryKey: [...key, "subitems", parent.id, archived],
                })
              }
            >
              Reload subitems
            </Button>
          )}
          {(query.error || mutation.error) && (
            <p role="alert" className="text-sm text-destructive">
              {(query.error || mutation.error)?.message}
            </p>
          )}
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {notice?.message}
            {notice?.pending && (
              <Link className="ml-2 text-primary underline" href="/approvals">
                View requests
              </Link>
            )}
          </p>
        </>
      )}
    </section>
  );
}
