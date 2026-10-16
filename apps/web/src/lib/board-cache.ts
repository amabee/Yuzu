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
