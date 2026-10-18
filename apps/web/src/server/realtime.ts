import { getDatabase } from "@yuzu/database";
import { signRealtimeToken } from "@yuzu/realtime-protocol";
import { recordId } from "@/lib/board-contract";
import { boardScope, requireIdentity } from "./team-access";
import { SetupError } from "./setup/security";
import { z } from "zod";
export async function authorizeBoardRealtime(
  boardId: string | undefined,
  headers: Headers,
) {
  const { user } = await requireIdentity(headers);
  if (boardId) {
    const board = await getDatabase().board.findFirst({
      where: { id: boardId, ...boardScope(user) },
      select: { id: true },
    });
    if (!board)
      throw new SetupError(
        404,
        "NOT_FOUND",
        "This board is not available to you.",
      );
  }
  const secret = process.env.REALTIME_SECRET;
  const url = process.env.REALTIME_PUBLIC_URL;
  if (!secret || !url || !process.env.REALTIME_INTERNAL_URL)
    return { enabled: false as const };
  return {
    enabled: true as const,
    url,
    token: signRealtimeToken(
      {
        ...(boardId
          ? { purpose: "board" as const, boardId }
          : { purpose: "user" as const }),
        userId: user.id,
        expiresAt: Date.now() + 60_000,
      },
      secret,
    ),
  };
}
export async function notifyBoardMutation(input: unknown, result?: unknown) {
  const secret = process.env.REALTIME_SECRET;
  const internalURL = process.env.REALTIME_INTERNAL_URL;
  if (!secret || !internalURL) return;
  try {
    const body = z
      .object({
        boardId: recordId.optional(),
        taskId: recordId.nullable().optional(),
        createKey: recordId.optional(),
        userId: z.string().optional(),
        invalidated: z.number().optional(),
        affectedUserIds: z.array(z.string()).optional(),
        notificationOnly: z.boolean().optional(),
      })
      .passthrough()
      .parse(input);
    if (body.notificationOnly && body.boardId && body.userId) {
      const response = await fetch(new URL("/events", internalURL), {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: signRealtimeToken(
          {
            purpose: "event",
            boardId: body.boardId,
            userIds: [body.userId],
            notifyBoard: false,
            eventId: crypto.randomUUID(),
            expiresAt: Date.now() + 10_000,
          },
          secret,
        ),
        signal: AbortSignal.timeout(1000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Realtime service unavailable.");
      return;
    }
    const boardId =
      body.boardId ??
      (body.taskId
        ? (
            await getDatabase().task.findUnique({
              where: { id: body.taskId },
              select: { boardId: true },
            })
          )?.boardId
        : undefined);
    if (!boardId) return;
    const board = await getDatabase().board.findUnique({
      where: { id: boardId },
      select: {
        managers: { select: { userId: true } },
        workspace: { select: { members: { select: { userId: true } } } },
        project: {
          select: {
            visibility: true,
            members: { select: { userId: true } },
          },
        },
        approvalPolicy: {
          select: { primaryApproverId: true, backupApproverId: true },
        },
      },
    });
    const proposalId = z
      .object({ proposalId: recordId.optional() })
      .passthrough()
      .safeParse(result ?? input);
    const author =
      proposalId.success && proposalId.data.proposalId
        ? await getDatabase().boardProposal.findUnique({
            where: { id: proposalId.data.proposalId },
            select: { authorId: true },
          })
        : null;
    const affectedAuthors =
      body.taskId || (body.boardId && !body.createKey)
        ? await getDatabase().boardProposal.findMany({
            where: {
              boardId,
              ...(body.taskId ? { taskId: body.taskId } : {}),
              OR: [
                { status: "PENDING" },
                {
                  status: "STALE",
                  ...(body.invalidated ? {} : { id: "no-stale-notifications" }),
                  decidedAt: { gte: new Date(Date.now() - 10_000) },
                },
              ],
            },
            distinct: ["authorId"],
            select: { authorId: true },
          })
        : [];
    const administrators = await getDatabase().user.findMany({
      where: { role: { in: ["OWNER", "ADMIN"] } },
      select: { id: true },
    });
    const inboxRecipients = await getDatabase().notification.findMany({
      where: { boardId, createdAt: { gte: new Date(Date.now() - 10_000) } },
      distinct: ["recipientId"],
      select: { recipientId: true },
    });
    // Boards in a private project only ever notify that project's members:
    // even a hint that the board changed would reveal that it exists.
    const privateAudience =
      board?.project?.visibility === "PRIVATE"
        ? new Set(board.project.members.map((member) => member.userId))
        : null;
    const recipients = [
      ...new Set(
        [
          author?.authorId,
          body.userId,
          ...(body.affectedUserIds ?? []),
          board?.approvalPolicy?.primaryApproverId,
          board?.approvalPolicy?.backupApproverId,
          ...(board?.managers.map((manager) => manager.userId) ?? []),
          // Overview and cross-board search also need hints while no board room is open.
          ...(board?.workspace.members.map((member) => member.userId) ?? []),
          ...affectedAuthors.map((item) => item.authorId),
          ...administrators.map((item) => item.id),
          ...inboxRecipients.map((item) => item.recipientId),
        ].filter((id): id is string => Boolean(id)),
      ),
    ].filter((id) => !privateAudience || privateAudience.has(id));
    const batches = recipients.length
      ? Array.from({ length: Math.ceil(recipients.length / 20) }, (_, i) =>
          recipients.slice(i * 20, (i + 1) * 20),
        )
      : [[]];
    await Promise.all(
      batches.map(async (userIds, index) => {
        const token = signRealtimeToken(
          {
            purpose: "event",
            boardId,
            eventId: crypto.randomUUID(),
            userIds,
            notifyBoard: index === 0,
            ...(body.taskId ? { taskId: body.taskId } : {}),
            expiresAt: Date.now() + 10_000,
          },
          secret,
        );
        const response = await fetch(new URL("/events", internalURL), {
          method: "POST",
          body: token,
          headers: { "Content-Type": "text/plain" },
          signal: AbortSignal.timeout(1000),
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Realtime service unavailable.");
      }),
    );
  } catch {
    // The database commit is authoritative. Lost hints are recovered on reconnect/fallback sync.
    console.warn(
      "Live board notification could not be delivered; periodic sync will recover it.",
    );
  }
}
