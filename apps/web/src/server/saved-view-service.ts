import { stableJson } from "@/lib/approval-rules";
import { createRecordId } from "@yuzu/database";
import {
  saveViewSchema,
  selectViewSchema,
  removeViewSchema,
} from "@/lib/saved-view-contract";
import { fieldOptions } from "@/lib/board-contract";
import { access, serial } from "./board-service";
import { requireIdentity } from "./team-access";
import { SetupError } from "./setup/security";

export async function mutateSavedView(
  action: string,
  input: unknown,
  headers: Headers,
) {
  const { user } = await requireIdentity(headers);
  const value =
    action === "save-view"
      ? { ...saveViewSchema.parse(input), operation: "save" as const }
      : action === "select-view"
        ? { ...selectViewSchema.parse(input), operation: "select" as const }
        : { ...removeViewSchema.parse(input), operation: "remove" as const };
  return serial(async (tx) => {
    const context = await access(
      tx,
      user.id,
      value.boardId,
      action !== "select-view",
    );
    const selectionKey = { boardId: value.boardId, userId: user.id };
    if (value.operation === "select") {
      if (
        value.viewId &&
        !(await tx.savedBoardView.findFirst({
          where: {
            id: value.viewId,
            boardId: value.boardId,
            OR: [{ ownerId: user.id }, { visibility: "SHARED" }],
          },
        }))
      )
        throw new SetupError(
          404,
          "VIEW_NOT_FOUND",
          "This view is no longer available.",
        );
      await tx.boardViewSelection.upsert({
        where: { boardId_userId: selectionKey },
        create: { ...selectionKey, viewId: value.viewId },
        update: { viewId: value.viewId },
      });
      return {
        boardId: value.boardId,
        selectedViewId: value.viewId,
        notificationOnly: true,
        userId: user.id,
      };
    }
    const existing = await tx.savedBoardView.findFirst({
      where: { id: value.id, boardId: value.boardId },
    });
    if (
      existing &&
      (existing.visibility === "SHARED"
        ? !context.canManage
        : existing.ownerId !== user.id)
    )
      throw new SetupError(
        403,
        "VIEW_FORBIDDEN",
        "You cannot change this saved view.",
      );
    if (value.operation === "save") {
      if (value.visibility === "SHARED" && !context.canManage)
        throw new SetupError(
          403,
          "VIEW_FORBIDDEN",
          "Only board managers can share views.",
        );
      // Changing a shared view into a private one would strand teammates' selections.
      if (existing && existing.visibility !== value.visibility)
        throw new SetupError(
          422,
          "VIEW_VISIBILITY",
          "Save a new view to change who can see it.",
        );
      const statuses = fieldOptions(
        context.board.columns.find((field) => field.key === "status")?.config,
      );
      if (
        value.config.statusId &&
        value.config.statusId !== "__none__" &&
        !statuses.some((status) => status.id === value.config.statusId)
      )
        throw new SetupError(
          422,
          "VIEW_STATUS",
          "Choose a current status before saving this view.",
        );
      if (
        value.config.groupId &&
        !context.board.groups.some((group) => group.id === value.config.groupId)
      )
        throw new SetupError(
          422,
          "VIEW_GROUP",
          "Choose a current group before saving this view.",
        );
      if (
        existing &&
        value.revision === 0 &&
        existing.ownerId === user.id &&
        existing.revision === 1 &&
        existing.name === value.name &&
        existing.visibility === value.visibility &&
        stableJson(existing.config) === stableJson(value.config)
      )
        return {
          boardId: value.boardId,
          viewId: existing.id,
          notificationOnly: existing.visibility === "PERSONAL",
          userId: user.id,
        };
      if (
        (existing?.revision ?? 0) !== value.revision ||
        (!existing && value.revision !== 0)
      )
        throw new SetupError(
          409,
          "VIEW_CHANGED",
          "This view changed or was removed. Reopen it before saving again.",
        );
      const data = {
        name: value.name,
        visibility: value.visibility,
        config: value.config,
      };
      if (existing)
        await tx.savedBoardView.update({
          where: { id: existing.id },
          data: { ...data, revision: { increment: 1 } },
        });
      else {
        const count = await tx.savedBoardView.count({
          where: {
            boardId: value.boardId,
            OR: [{ ownerId: user.id }, { visibility: "SHARED" }],
          },
        });
        if (count >= 100)
          throw new SetupError(
            422,
            "VIEW_LIMIT",
            "Remove an unused view before adding more (100 per board).",
          );
        await tx.savedBoardView.create({
          data: {
            ...data,
            id: value.id,
            ownerId: user.id,
            boardId: value.boardId,
          },
        });
      }
      await tx.boardViewSelection.upsert({
        where: { boardId_userId: selectionKey },
        create: { ...selectionKey, viewId: value.id },
        update: { viewId: value.id },
      });
    } else {
      if (!existing)
        throw new SetupError(
          404,
          "VIEW_NOT_FOUND",
          "This view is no longer available.",
        );
      if (existing.revision !== value.revision)
        throw new SetupError(
          409,
          "VIEW_CHANGED",
          "This view changed. Reopen it before removing it.",
        );
      await tx.savedBoardView.delete({ where: { id: existing.id } });
    }
    await tx.boardEvent.create({
      data: {
        id: createRecordId(),
        boardId: value.boardId,
        actorId: user.id,
        action:
          value.operation === "save"
            ? "Saved board view"
            : "Removed board view",
        after: { viewId: value.id },
      },
    });
    return {
      boardId: value.boardId,
      viewId: value.id,
      notificationOnly:
        (value.operation === "save"
          ? value.visibility
          : existing!.visibility) === "PERSONAL",
      userId: user.id,
    };
  });
}
