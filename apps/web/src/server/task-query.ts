import { hierarchyScope } from "./task-hierarchy";
import type { Prisma } from "@yuzu/database";
import type { ViewConfig } from "@/lib/saved-view-contract";
import { calendarWindow, escapeLike } from "@/lib/board-query";

export function taskWhere(
  boardId: string,
  config: ViewConfig | null,
  userId: string,
  today: string,
): Prisma.TaskWhereInput {
  // Records in Trash never show on the board.
  if (!config) return { boardId, parentId: null, deletedAt: null };
  const dates = calendarWindow(today);
  return {
    boardId,
    ...((config.scope ?? "ROOTS") === "ROOTS"
      ? {
          parentId: null,
          deletedAt: null,
          archivedAt: config.archived ? { not: null } : null,
          ...(config.groupId ? { groupId: config.groupId } : {}),
        }
      : {
          ...(config.scope === "SUBITEMS" ? { parentId: { not: null } } : {}),
          AND: [
            hierarchyScope(config.archived),
            ...(config.groupId
              ? [
                  {
                    OR: [
                      { parentId: null, groupId: config.groupId },
                      { parent: { groupId: config.groupId } },
                    ],
                  },
                ]
              : []),
          ],
        }),
    ...(config.statusId
      ? { statusId: config.statusId === "__none__" ? null : config.statusId }
      : {}),
    ...(config.priority !== "all" ? { priority: config.priority } : {}),
    ...(config.assignee === "me"
      ? { assignees: { some: { userId } } }
      : config.assignee === "unassigned"
        ? { assignees: { none: {} } }
        : {}),
    ...(config.due === "none"
      ? { dueDate: null }
      : config.due === "overdue"
        ? { dueDate: { lt: dates.start } }
        : config.due === "next-week"
          ? { dueDate: { gte: dates.start, lte: dates.end } }
          : {}),
    ...(config.search
      ? {
          OR: [
            {
              name: {
                contains: escapeLike(config.search),
                mode: "insensitive",
              },
            },
            {
              description: {
                contains: escapeLike(config.search),
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
  };
}
export function taskOrder(
  sort?: ViewConfig["sort"],
): Prisma.TaskOrderByWithRelationInput[] {
  return sort === "name"
    ? [{ name: "asc" }, { id: "asc" }]
    : sort === "due"
      ? [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }]
      : [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }];
}
