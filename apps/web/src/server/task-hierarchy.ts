import type { DatabaseTransaction, Prisma } from "@yuzu/database";
import { SetupError } from "./setup/security";

export const parentTaskSelect = {
  id: true,
  boardId: true,
  parentId: true,
  groupId: true,
  createdById: true,
  archivedAt: true,
  deletedAt: true,
  revision: true,
  childrenRevision: true,
  assignees: { select: { userId: true } },
  editors: { select: { userId: true } },
} satisfies Prisma.TaskSelect;
export type ParentTask = Prisma.TaskGetPayload<{
  select: typeof parentTaskSelect;
}>;
export type HierarchyTask = {
  id: string;
  boardId: string;
  parentId: string | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
  parent: ParentTask | null;
};
export const unavailableTask = () =>
  new SetupError(
    404,
    "NOT_FOUND",
    "This board or task is not available to you.",
  );
export function taskAvailable(task: HierarchyTask) {
  return (
    !task.deletedAt &&
    (!task.parentId ||
      Boolean(
        task.parent &&
        task.parent.id === task.parentId &&
        !task.parent.parentId &&
        task.parent.boardId === task.boardId &&
        !task.parent.deletedAt,
      ))
  );
}
export function taskArchived(task: HierarchyTask) {
  return Boolean(task.archivedAt || task.parent?.archivedAt);
}
export function parentCanEdit(task: HierarchyTask, userId: string) {
  const parent = task.parent;
  return Boolean(
    parent &&
    (parent.createdById === userId ||
      parent.assignees.some((person) => person.userId === userId) ||
      parent.editors.some((person) => person.userId === userId)),
  );
}
export async function lockTaskRoot(
  tx: DatabaseTransaction,
  id: string,
  boardId: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id"=${id} AND "boardId"=${boardId} FOR UPDATE`;
  const root = await tx.task.findFirst({
    where: { id, boardId, parentId: null },
    select: parentTaskSelect,
  });
  if (!root) throw unavailableTask();
  return root;
}
export async function markChildrenChanged(
  tx: DatabaseTransaction,
  rootId: string,
) {
  await tx.task.update({
    where: { id: rootId },
    data: { childrenRevision: { increment: 1 } },
  });
}
export async function checkSubitemCapacity(
  tx: DatabaseTransaction,
  rootId: string,
  applyingReservation = false,
) {
  const retained = await tx.task.count({ where: { parentId: rootId } });
  const pending = await tx.boardProposal.count({
    where: { parentTaskId: rootId, status: "PENDING" },
  });
  if (retained + pending + (applyingReservation ? 0 : 1) > 200)
    throw new SetupError(
      409,
      "SUBITEM_CAPACITY",
      "Subitem capacity reached. Ask a board manager to review the breakdown.",
    );
}
export async function internalSubitemWrite(tx: DatabaseTransaction) {
  await tx.$queryRaw`SELECT set_config('yuzu.subitems_internal', 'on', true)`;
}
/** Legacy root archive/delete requests are safe only while no breakdown exists. */
export async function guardRootLifecycle(
  tx: DatabaseTransaction,
  task: {
    id: string;
    boardId: string;
    parentId: string | null;
    revision: number;
  },
  expected?: number,
) {
  const root = await lockTaskRoot(tx, task.parentId ?? task.id, task.boardId);
  if (task.parentId) return root;
  const attached = await tx.task.count({ where: { parentId: root.id } });
  const reserved = await tx.boardProposal.count({
    where: { parentTaskId: root.id, status: "PENDING" },
  });
  if (
    root.revision !== task.revision ||
    ((attached || reserved || expected !== undefined) &&
      expected !== root.childrenRevision)
  )
    throw new SetupError(
      409,
      "HIERARCHY_CHANGED",
      "This breakdown changed. Refresh and review it before continuing.",
    );
  return root;
}
