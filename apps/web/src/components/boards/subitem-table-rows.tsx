"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import {
  recordOf,
  type BoardField,
  type BoardState,
  type BoardTask,
} from "@/lib/board-contract";
import {
  AssigneeAvatars,
  formatDueDate,
  optionBadgeStyle,
  priorityOptions,
} from "./board-presentation";
import type { LinkedRecord } from "@/lib/record-links";
import { Button } from "@/components/ui/button";

type Page = {
  linked?: Record<string, LinkedRecord>;
  items: BoardTask[];
  nextCursor: string | null;
  total: number;
  done: number;
};
export function SubitemTableRows({
  state,
  parent,
  fields,
  checklist,
  onOpen,
  formatCustom,
}: {
  state: BoardState;
  parent: BoardTask;
  fields: BoardField[];
  checklist: boolean;
  onOpen: (id: string) => void;
  formatCustom: (task: BoardTask, field: BoardField) => string;
}) {
  const query = useInfiniteQuery({
    queryKey: [
      "principal",
      state.currentUserId,
      "boards",
      state.boardId,
      "subitems",
      parent.id,
      false,
    ],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) =>
      (
        await apiRequest<Page>(
          `/api/v1/boards/subitems?${new URLSearchParams({ boardId: state.boardId, parentId: parent.id, ...(pageParam ? { cursor: pageParam } : {}) })}`,
          { signal, cache: "no-store" },
        )
      ).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15000,
  });
  const linked = Object.assign(
    {},
    ...(query.data?.pages.map((p) => p.linked ?? {}) ?? []),
  ) as Record<string, LinkedRecord>;
  const columns = Math.max(fields.length, 1) + (checklist ? 1 : 0);
  const shown = fields.length
    ? fields
    : [
        {
          id: "name",
          key: "name",
          name: recordOf(state).singular,
          type: "TEXT",
          options: [],
          version: "",
        },
      ];
  return (
    <>
      <tr>
        <td
          colSpan={columns}
          className="bg-muted/30 px-5 py-2 text-xs text-muted-foreground"
        >
          Full breakdown of {parent.name}. Board filters do not narrow these
          subitems.{" "}
          <button
            type="button"
            className="text-primary underline"
            onClick={() => onOpen(parent.id)}
          >
            Add or reorder in parent task
          </button>
        </td>
      </tr>
      {query.data?.pages
        .flatMap((p) => p.items)
        .map((child) => (
          <tr
            key={child.id}
            data-task-id={child.id}
            data-subitem="true"
            className="bg-muted/20"
          >
            {shown.map((field) => (
              <td key={field.id} className="border-b px-4 py-3 text-sm">
                {field.key === "name" ? (
                  <button
                    type="button"
                    className="subitem-open pl-5 text-left font-medium text-primary"
                    onClick={() => onOpen(child.id)}
                  >
                    ↳ {child.name}
                  </button>
                ) : field.key === "assignees" ? (
                  <AssigneeAvatars
                    ids={child.assigneeIds}
                    people={state.people}
                  />
                ) : field.key === "status" ? (
                  <span
                    style={optionBadgeStyle(
                      field.options.find((o) => o.id === child.statusId),
                    )}
                  >
                    {field.options.find((o) => o.id === child.statusId)
                      ?.label ?? "No status"}
                  </span>
                ) : field.key === "priority" ? (
                  (priorityOptions(state).find((o) => o.id === child.priority)
                    ?.label ?? child.priority)
                ) : field.key === "start_date" ? (
                  child.startDate ? (
                    formatDueDate(child.startDate)
                  ) : (
                    "—"
                  )
                ) : field.key === "due_date" ? (
                  child.dueDate ? (
                    formatDueDate(child.dueDate)
                  ) : (
                    "—"
                  )
                ) : field.type === "RELATION" ? (
                  (Array.isArray(child.fieldValues[field.id])
                    ? (child.fieldValues[field.id] as string[])
                        .map((id) => linked[id]?.name ?? "Private item")
                        .join(", ")
                    : "") || "—"
                ) : field.key === "description" ? (
                  child.description || "—"
                ) : field.key === "group" ? (
                  (state.groups.find((g) => g.id === child.groupId)?.name ??
                  "No group")
                ) : (
                  formatCustom(child, field)
                )}
              </td>
            ))}
            {checklist && (
              <td className="border-b px-4 py-3 text-sm">
                {child.checklist.filter((c) => c.done).length}/
                {child.checklist.length}
              </td>
            )}
          </tr>
        ))}
      {(query.hasNextPage ||
        query.isPending ||
        query.error ||
        query.data?.pages[0]?.total === 0) && (
        <tr>
          <td
            colSpan={columns}
            className="px-5 py-3 text-sm text-muted-foreground"
          >
            {query.isPending ? (
              "Loading subitems…"
            ) : query.error ? (
              query.error.message
            ) : query.hasNextPage ? (
              <Button
                type="button"
                variant="ghost"
                disabled={query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
              >
                Load more subitems
              </Button>
            ) : (
              "No active subitems yet."
            )}
          </td>
        </tr>
      )}
    </>
  );
}
