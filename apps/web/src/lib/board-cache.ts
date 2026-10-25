import type { BoardState } from "./board-contract";

/** Keep shared entities current without replacing another filter's page or totals. */
export function mergeBoardState(
  current: BoardState,
  fresh: BoardState,
): BoardState {
  if (
    current.boardId !== fresh.boardId ||
    current.currentUserId !== fresh.currentUserId
  )
    return current;
  const tasks = new Map(
    [...fresh.tasks, ...(fresh.focusedTask ? [fresh.focusedTask] : [])].map(
      (task) => [task.id, task],
    ),
  );
  const update = (task: BoardState["tasks"][number]) => {
    const next = tasks.get(task.id);
    return next && next.revision >= task.revision ? next : task;
  };
  return {
    ...fresh,
    pagination: current.pagination,
    tasks: current.tasks.map(update),
    focusedTask: current.focusedTask
      ? update(current.focusedTask)
      : current.focusedTask,
  };
}

/** Update only existing copies; paged child lists share the board query prefix. */
export function mapBoardTaskCopies<T>(
  current: T,
  update: (task: BoardState["tasks"][number]) => BoardState["tasks"][number],
): T {
  if (!current || typeof current !== "object") return current;
  const value = current as Record<string, unknown>;
  const next = { ...value };
  for (const key of ["tasks", "items", "undated", "unscheduled"]) {
    if (Array.isArray(value[key]))
      next[key] = value[key].map((task) =>
        task &&
        typeof task === "object" &&
        typeof task.id === "string" &&
        typeof task.revision === "number"
          ? update(task)
          : task,
      );
  }
  if (value.focusedTask && typeof value.focusedTask === "object")
    next.focusedTask = update(value.focusedTask as BoardState["tasks"][number]);
  if (Array.isArray(value.pages))
    next.pages = value.pages.map((page) => mapBoardTaskCopies(page, update));
  return next as T;
}
