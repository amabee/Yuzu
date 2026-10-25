import { hierarchyScope } from "./task-hierarchy";
import { asRecordType, resolveRecordConfig } from "@/lib/record-types";
import { getDatabase, type Prisma } from "@yuzu/database";
import {
  taskSearchQuerySchema,
  TASK_SEARCH_PAGE_SIZE,
  type TaskSearchResult,
} from "@/lib/task-search-contract";
import { escapeLike } from "@/lib/board-query";
import { boardScope, requireIdentity } from "./team-access";

export async function searchTasks(
  headers: Headers,
  input: unknown,
): Promise<TaskSearchResult> {
  const query = taskSearchQuerySchema.parse(input);
  const { user } = await requireIdentity(headers);
  const where: Prisma.TaskWhereInput = {
    AND: [hierarchyScope(query.archived === "true")],
    board: boardScope(user),
    deletedAt: null,

    OR: [
      { name: { contains: escapeLike(query.q), mode: "insensitive" } },
      { description: { contains: escapeLike(query.q), mode: "insensitive" } },
    ],
  };
  return getDatabase().$transaction(
    async (tx) => {
      const total = await tx.task.count({ where });
      const rows = await tx.task.findMany({
        where: {
          ...where,
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: "desc" },
        take: TASK_SEARCH_PAGE_SIZE + 1,
        select: {
          id: true,
          name: true,
          description: true,
          parentId: true,
          parent: { select: { name: true, archivedAt: true } },
          dueDate: true,
          archivedAt: true,
          board: {
            select: {
              id: true,
              name: true,
              recordType: true,
              recordConfig: true,
              workspace: { select: { name: true } },
              project: { select: { name: true } },
            },
          },
        },
      });
      const tasks = rows.slice(0, TASK_SEARCH_PAGE_SIZE);
      return {
        total,
        nextCursor:
          rows.length > TASK_SEARCH_PAGE_SIZE ? tasks.at(-1)!.id : null,
        tasks: tasks.map((task) => ({
          id: task.id,
          name: task.name,
          description: task.description.slice(0, 240),
          dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
          parentId: task.parentId,
          parentName: task.parent?.name ?? null,
          archived: Boolean(task.archivedAt || task.parent?.archivedAt),
          boardId: task.board.id,
          boardName: task.board.name,
          recordName: task.parentId
            ? "Subitem"
            : resolveRecordConfig(
                asRecordType(task.board.recordType),
                task.board.recordConfig,
              ).singular,
          workspaceName: task.board.workspace.name,
          projectName: task.board.project?.name ?? null,
        })),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 15000 },
  );
}
