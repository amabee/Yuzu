import { boardArchiveSchema } from "@/lib/board-contract";
import { access, serial } from "./board-service";
import { requireIdentity } from "./team-access";
import { SetupError } from "./setup/security";

/** Archive changes only the board flag, preserving individual task archives. */
export async function setBoardArchived(input: unknown, headers: Headers) {
  const body = boardArchiveSchema.parse(input);
  const { user } = await requireIdentity(headers);
  return serial(async (tx) => {
    // Read access permits restoration while the board is archived.
    const context = await access(tx, user.id, body.boardId);
    if (!context.canManage)
      throw new SetupError(
        403,
        "FORBIDDEN",
        "Only board managers and administrators can archive or restore boards.",
      );
    const settings = await tx.installationSettings.findUniqueOrThrow({
      where: { id: "installation" },
    });
    if (settings.maintenanceMode)
      throw new SetupError(
        503,
        "MAINTENANCE",
        "Changes are paused during maintenance.",
      );
    if (context.board.updatedAt.toISOString() !== body.version)
      throw new SetupError(
        409,
        "BOARD_CHANGED",
        "This board changed. Refresh before archiving or restoring it.",
      );
    const alreadyArchived = Boolean(context.board.archivedAt);
    if (alreadyArchived === body.archived)
      return { boardId: body.boardId, archived: body.archived };
    // Monotonic version also protects rapid archive/restore within one millisecond.
    const updatedAt = new Date(
      Math.max(Date.now(), context.board.updatedAt.getTime() + 1),
    );
    await tx.board.update({
      where: { id: body.boardId },
      data: { archivedAt: body.archived ? updatedAt : null, updatedAt },
    });
    await tx.boardEvent.create({
      data: {
        boardId: body.boardId,
        actorId: user.id,
        action: body.archived ? "Archived board" : "Restored board",
        before: { archived: alreadyArchived },
        after: { archived: body.archived },
      },
    });
    return { boardId: body.boardId, archived: body.archived };
  });
}
