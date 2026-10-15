import { getDatabase } from "@yuzu/database";
import { z } from "zod";
import {
  notificationActionSchema,
  type NotificationInbox,
} from "@/lib/notification-contract";
import { recordId } from "@/lib/id-contract";
import {
  requireIdentity,
  workspaceScope,
  isAdministrator,
} from "./team-access";
import { SetupError } from "./setup/security";
import { serial } from "./board-service";

function visibility(user: { id: string; role: string }) {
  return {
    recipientId: user.id,
    board: { workspace: workspaceScope(user) },
    ...(isAdministrator(user.role)
      ? {}
      : {
          OR: [
            { kind: "ASSIGNMENT" as const },
            { kind: "MENTION" as const },
            { proposal: { is: { authorId: user.id } } },
            { board: { managers: { some: { userId: user.id } } } },
            {
              board: {
                approvalPolicy: {
                  is: {
                    OR: [
                      { primaryApproverId: user.id },
                      { backupApproverId: user.id },
                    ],
                  },
                },
              },
            },
          ],
        }),
  };
}
const missing = () =>
  new SetupError(
    404,
    "NOT_FOUND",
    "This notification is no longer available to you.",
  );
export async function notificationInbox(
  headers: Headers,
  input: unknown = {},
): Promise<NotificationInbox> {
  const { user } = await requireIdentity(headers);
  const { filter, cursor } = z
    .object({
      filter: z.enum(["ALL", "UNREAD"]).default("ALL"),
      cursor: recordId.optional(),
    })
    .strict()
    .parse(input);
  return getDatabase().$transaction(async (tx) => {
    const scope = visibility(user);
    const rows = await tx.notification.findMany({
      where: {
        ...scope,
        ...(filter === "UNREAD" ? { readAt: null } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: 31,
      include: {
        actor: { select: { name: true } },
        board: { select: { name: true } },
        task: { select: { name: true } },
        proposal: { select: { changes: true } },
      },
    });
    return {
      unreadCount: await tx.notification.count({
        where: { ...scope, readAt: null },
      }),
      nextCursor: rows.length > 30 ? rows[29]!.id : null,
      items: rows.slice(0, 30).map((row) => ({
        id: row.id,
        kind: row.kind,
        message: row.message,
        actorName: row.actor.name,
        name:
          row.task?.name ??
          String(
            (row.proposal?.changes as Record<string, unknown> | undefined)
              ?.name ?? "Task request",
          ),
        boardName: row.board.name,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      })),
    };
  });
}
export async function changeNotification(headers: Headers, input: unknown) {
  // Read/unread is a scoped personal preference, not a task mutation.
  const { user } = await requireIdentity(headers, { allowMaintenance: true });
  const body = notificationActionSchema.parse(input);
  return serial(async (tx) => {
    const scope = visibility(user);
    const id = body.action === "read-all" ? body.throughId : body.id;
    const row = await tx.notification.findFirst({ where: { ...scope, id } });
    if (!row) throw missing();
    if (body.action === "read-all") {
      const result = await tx.notification.updateMany({
        where: { ...scope, readAt: null, id: { lte: id } },
        data: { readAt: new Date() },
      });
      return { changed: result.count, boardId: row.boardId, userId: user.id };
    }
    await tx.notification.update({
      where: { id: row.id },
      data: {
        readAt:
          body.action === "read" && !body.read
            ? null
            : (row.readAt ?? new Date()),
      },
    });
    return {
      changed: 1,
      boardId: row.boardId,
      userId: user.id,
      ...(body.action === "open"
        ? {
            href: row.proposalId
              ? `/approvals?request=${row.proposalId}`
              : `/boards/${row.boardId}${row.taskId ? `?task=${row.taskId}${row.kind === "MENTION" ? "&tab=comments" : ""}` : ""}`,
          }
        : {}),
    };
  });
}
