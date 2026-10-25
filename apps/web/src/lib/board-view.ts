import type { BoardTask } from "./board-contract";
import { dueMatches, type ViewConfig } from "./saved-view-contract";

export type ViewTask = Pick<
  BoardTask,
  | "parentId"
  | "id"
  | "name"
  | "description"
  | "archivedAt"
  | "statusId"
  | "assigneeIds"
  | "priority"
  | "dueDate"
  | "groupId"
>;

export function matchesBoardView(
  task: ViewTask,
  config: ViewConfig,
  userId: string,
  calendarDate: string,
) {
  return (
    ((config.scope ?? "ROOTS") === "BOTH" ||
      ((config.scope ?? "ROOTS") === "SUBITEMS"
        ? Boolean(task.parentId)
        : !task.parentId)) &&
    Boolean(task.archivedAt) === config.archived &&
    (!config.statusId ||
      (config.statusId === "__none__"
        ? !task.statusId
        : task.statusId === config.statusId)) &&
    (config.assignee === "all" ||
      (config.assignee === "me"
        ? task.assigneeIds.includes(userId)
        : !task.assigneeIds.length)) &&
    (config.priority === "all" || task.priority === config.priority) &&
    dueMatches(
      task.dueDate,
      config.due,
      new Date(`${calendarDate}T12:00:00`),
    ) &&
    (!config.groupId || task.groupId === config.groupId) &&
    (task.name.toLowerCase().includes(config.search.toLowerCase()) ||
      task.description.toLowerCase().includes(config.search.toLowerCase()))
  );
}

export function compareBoardView(
  a: Pick<ViewTask, "name" | "dueDate">,
  b: Pick<ViewTask, "name" | "dueDate">,
  sort: ViewConfig["sort"],
) {
  return sort === "name"
    ? a.name.localeCompare(b.name, "en")
    : sort === "due"
      ? (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
      : 0;
}
