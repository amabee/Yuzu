import { getDatabase, type Prisma } from "@yuzu/database";
import { fieldOptions } from "@/lib/board-contract";
import { calendarWindow } from "@/lib/board-query";
import {
  COMPLETED_STATUS_ID,
  DASHBOARD_BOARD_PAGE_SIZE,
  dashboardQuerySchema,
  type Dashboard,
} from "@/lib/dashboard-contract";
import { boardScope, requireIdentity } from "./team-access";

export async function workspaceDashboard(
  headers: Headers,
  input: unknown = {},
): Promise<Dashboard> {
  const query = dashboardQuerySchema.parse(input);
  const { user, settings } = await requireIdentity(headers);
  const calendarDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const { start, end } = calendarWindow(calendarDate);
  // Task counts only make sense for Task boards; other record types get
  // their own dashboards (phase 2).
  const visibleBoards: Prisma.BoardWhereInput = {
    ...boardScope(user),
    recordType: "TASK",
    ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
    // boardScope above still applies, so a hidden project matches nothing.
    ...(query.projectId ? { projectId: query.projectId } : {}),
  };
  const active: Prisma.TaskWhereInput = {
    board: visibleBoards,
    archivedAt: null,
  };
  const open: Prisma.TaskWhereInput = {
    ...active,
    OR: [{ statusId: null }, { statusId: { not: COMPLETED_STATUS_ID } }],
  };
  const overdue = { ...open, dueDate: { lt: start } };
  const upcoming = { ...open, dueDate: { gte: start, lte: end } };
  return getDatabase().$transaction(
    async (tx) => {
      const boardCount = await tx.board.count({ where: visibleBoards });
      const pageCount = Math.max(
        1,
        Math.ceil(boardCount / DASHBOARD_BOARD_PAGE_SIZE),
      );
      const page = Math.min(query.page, pageCount);
      const boards = await tx.board.findMany({
        where: visibleBoards,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: DASHBOARD_BOARD_PAGE_SIZE,
        skip: (page - 1) * DASHBOARD_BOARD_PAGE_SIZE,
        select: {
          id: true,
          name: true,
          workspace: { select: { name: true } },
          columns: {
            where: { key: "status", archivedAt: null },
            select: { config: true },
          },
        },
      });
      const total = await tx.task.count({ where: active });
      const openCount = await tx.task.count({ where: open });
      const overdueCount = await tx.task.count({ where: overdue });
      const upcomingCount = await tx.task.count({ where: upcoming });
      const unassigned = await tx.task.count({
        where: { ...open, assignees: { none: {} } },
      });
      const assignedToMe = { assignees: { some: { userId: user.id } } };
      const mine = {
        open: await tx.task.count({ where: { ...open, ...assignedToMe } }),
        upcoming: await tx.task.count({
          where: { ...upcoming, ...assignedToMe },
        }),
        overdue: await tx.task.count({
          where: { ...overdue, ...assignedToMe },
        }),
      };
      // "Mine" narrows only the week's lists; totals stay workspace-wide.
      const listScope = query.scope === "mine" ? assignedToMe : {};
      const boardIds = boards.map((board) => board.id);
      const counts = await tx.task.groupBy({
        by: ["boardId", "statusId"],
        where: { ...active, boardId: { in: boardIds } },
        _count: true,
      });
      const boardOverdue = await tx.task.groupBy({
        by: ["boardId"],
        where: { ...overdue, boardId: { in: boardIds } },
        _count: true,
      });
      const deadlineSelect = {
        id: true,
        name: true,
        dueDate: true,
        statusId: true,
        assignees: {
          take: 3,
          orderBy: { userId: "asc" },
          select: { user: { select: { id: true, name: true } } },
        },
        board: {
          select: {
            id: true,
            name: true,
            workspace: { select: { name: true } },
            columns: {
              where: { key: "status", archivedAt: null },
              select: { config: true },
            },
          },
        },
      } as const;
      const upcomingRows = await tx.task.findMany({
        where: { ...upcoming, ...listScope },
        select: deadlineSelect,
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: 10,
      });
      const overdueRows = await tx.task.findMany({
        where: { ...overdue, ...listScope },
        select: deadlineSelect,
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: 10,
      });
      const workload = await tx.taskAssignee.groupBy({
        by: ["userId"],
        where: { task: open },
        _count: true,
        orderBy: [{ _count: { userId: "desc" } }, { userId: "asc" }],
        take: 12,
      });
      const userIds = workload.map((person) => person.userId);
      const people = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, image: true },
      });
      const personOverdue = await tx.taskAssignee.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds }, task: overdue },
        _count: true,
      });
      const deadline = (task: (typeof upcomingRows)[number]) => ({
        id: task.id,
        name: task.name,
        boardId: task.board.id,
        boardName: task.board.name,
        workspaceName: task.board.workspace.name,
        status: (() => {
          if (!task.statusId) return null;
          const option = fieldOptions(task.board.columns[0]?.config).find(
            (item) => item.id === task.statusId,
          );
          return {
            id: task.statusId,
            label: option?.label ?? task.statusId,
            ...(option?.color ? { color: option.color } : {}),
          };
        })(),
        assignees: task.assignees.map((person) => person.user),
        dueDate: task.dueDate!.toISOString().slice(0, 10),
      });
      return {
        calendarDate,
        upcomingEnd: end.toISOString().slice(0, 10),
        total,
        open: openCount,
        completed: total - openCount,
        overdue: overdueCount,
        upcomingCount,
        unassigned,
        mine,
        boardCount,
        page,
        pageCount,
        upcoming: upcomingRows.map(deadline),
        overdueTasks: overdueRows.map(deadline),
        workload: workload.map((person) => ({
          userId: person.userId,
          name:
            people.find((user) => user.id === person.userId)?.name ??
            "Former member",
          image:
            people.find((user) => user.id === person.userId)?.image ?? null,
          count: person._count,
          overdue:
            personOverdue.find((row) => row.userId === person.userId)?._count ??
            0,
        })),
        boards: boards.map((board) => {
          const rows = counts.filter((row) => row.boardId === board.id);
          const options = fieldOptions(board.columns[0]?.config);
          const statuses = options.map((option) => ({
            ...option,
            count: rows.find((row) => row.statusId === option.id)?._count ?? 0,
          }));
          const other = rows
            .filter(
              (row) => !options.some((option) => option.id === row.statusId),
            )
            .map((row) => ({
              id: row.statusId,
              label: row.statusId ?? "No status",
              count: row._count,
            }));
          return {
            id: board.id,
            name: board.name,
            workspaceName: board.workspace.name,
            total: rows.reduce((sum, row) => sum + row._count, 0),
            overdue:
              boardOverdue.find((row) => row.boardId === board.id)?._count ?? 0,
            statuses: [...statuses, ...other],
          };
        }),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 15000 },
  );
}
