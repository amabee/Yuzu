import type { Prisma } from "@yuzu/database";
import type { ViewConfig } from "@/lib/saved-view-contract";
import { calendarWindow, escapeLike } from "@/lib/board-query";

export function taskWhere(
  boardId: string,
  config: ViewConfig | null,
  userId: string,
  today: string,
): Prisma.TaskWhereInput {
  if (!config) return { boardId };
  const dates = calendarWindow(today);
  return {
    boardId,
    archivedAt: config.archived ? { not: null } : null,
    ...(config.statusId
      ? { statusId: config.statusId === "__none__" ? null : config.statusId }
      : {}),
    ...(config.groupId ? { groupId: config.groupId } : {}),
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
