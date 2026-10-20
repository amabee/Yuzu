import { getDatabase, type DatabaseTransaction } from "@yuzu/database";
import {
  storageProvider,
  s3Bucket,
  writeS3Attachment,
  discardAttachmentObject,
  type AttachmentLocation,
} from "@yuzu/database/attachment-objects";
import { recordId } from "@/lib/id-contract";
import { attachmentName, attachmentTypes } from "@/lib/attachment-contract";
import { access, serial } from "./board-service";
import { requireIdentity } from "./team-access";
import { configuredOrigin, SetupError } from "./setup/security";
import {
  attachmentPath,
  discardAttachment,
  receiveAttachment,
} from "./attachment-storage";
import { validateAttachment } from "./attachment-validation";

const missing = () =>
  new SetupError(
    404,
    "NOT_FOUND",
    "This task or file is not available to you.",
  );
async function taskAccess(
  tx: DatabaseTransaction,
  userId: string,
  taskId: string,
  write = false,
) {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    include: { assignees: true, editors: true },
  });
  if (!task || task.deletedAt) throw missing();
  const context = await access(tx, userId, task.boardId, write);
  const canEdit =
    context.canManage ||
    task.createdById === userId ||
    task.assignees.some((person) => person.userId === userId) ||
    task.editors.some((person) => person.userId === userId);
  const settings = await tx.installationSettings.findUniqueOrThrow({
    where: { id: "installation" },
  });
  return {
    task,
    canEdit: !task.archivedAt && canEdit,
    canManage: context.canManage,
    settings,
  };
}
function allowWrite(context: Awaited<ReturnType<typeof taskAccess>>) {
  if (context.task.archivedAt)
    throw new SetupError(
      409,
      "TASK_ARCHIVED",
      "Archived tasks keep their files, but are read-only.",
    );
  if (!context.canEdit)
    throw new SetupError(
      403,
      "FORBIDDEN",
      "You need task editing permission to manage uploads.",
    );
}

export async function taskAttachments(taskId: string, headers: Headers) {
  recordId.parse(taskId);
  const { user } = await requireIdentity(headers);
  return getDatabase().$transaction(async (tx) => {
    const context = await taskAccess(tx, user.id, taskId);
    const files = await tx.taskAttachment.findMany({
      where: { taskId, removedAt: null },
      include: { uploadedBy: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return {
      maxSizeBytes: context.settings.maxAttachmentSizeBytes,
      allowedMimeTypes: context.settings.allowedAttachmentMimeTypes.filter(
        (mime) => mime in attachmentTypes,
      ),
      canUpload: context.canEdit && !context.settings.maintenanceMode,
      files: files.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        uploadedById: file.uploadedById,
        uploadedByName: file.uploadedBy.name,
        createdAt: file.createdAt.toISOString(),
        canRemove:
          context.canEdit &&
          !context.settings.maintenanceMode &&
          (file.uploadedById === user.id || context.canManage),
      })),
    };
  });
}

export async function uploadAttachment(taskId: string, request: Request) {
  if (request.headers.get("origin") !== configuredOrigin())
    throw new SetupError(
      403,
      "INVALID_ORIGIN",
      "Upload from Yuzu's configured address.",
    );
  recordId.parse(taskId);
  const uploadKey = recordId.parse(request.headers.get("x-yuzu-upload-key"));
  let rawName: string;
  try {
    rawName = decodeURIComponent(request.headers.get("x-yuzu-file-name") ?? "");
  } catch {
    throw new SetupError(422, "INVALID_FILE_NAME", "Choose a valid file name.");
  }
  const fileName = attachmentName.parse(rawName);
  const { user } = await requireIdentity(request.headers);
  const initial = await getDatabase().$transaction((tx) =>
    taskAccess(tx, user.id, taskId, true),
  );
  allowWrite(initial);
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  const expectedMime = Object.keys(attachmentTypes).find((mime) =>
    attachmentTypes[mime].includes(extension ?? ""),
  );
  if (
    !expectedMime ||
    !initial.settings.allowedAttachmentMimeTypes.includes(expectedMime)
  )
    throw new SetupError(
      415,
      "FILE_TYPE_NOT_ALLOWED",
      "Choose a file type allowed by the installation's upload policy.",
    );
  const provider = storageProvider();
  const bucket = provider === "S3" ? s3Bucket() : null;
  const received = await receiveAttachment(
    request,
    initial.settings.maxAttachmentSizeBytes,
  );
  let retained = false;
  let remoteAttempted = false;
  const location: AttachmentLocation = {
    storageKey: received.storageKey,
    storageProvider: provider,
    storageBucket: bucket,
  };
  try {
    const validated = await validateAttachment(
      attachmentPath(received.storageKey),
      fileName,
      request.headers.get("content-type") ?? "",
    );
    if (location.storageProvider === "S3") {
      remoteAttempted = true;
      await writeS3Attachment(
        received,
        location.storageBucket!,
        request.signal,
      );
    }
    // Recheck session, permissions and policy after the potentially slow transfer.
    const identity = await requireIdentity(request.headers);
    const result = await serial(async (tx) => {
      const current = await taskAccess(tx, identity.user.id, taskId, true);
      allowWrite(current);
      if (received.sizeBytes > current.settings.maxAttachmentSizeBytes)
        throw new SetupError(
          413,
          "FILE_TOO_LARGE",
          "The current upload limit is smaller than this file.",
        );
      if (
        !current.settings.allowedAttachmentMimeTypes.includes(
          validated.mimeType,
        )
      )
        throw new SetupError(
          415,
          "FILE_TYPE_NOT_ALLOWED",
          "This file type is disabled by the installation's upload policy.",
        );
      const existing = await tx.taskAttachment.findUnique({
        where: {
          taskId_uploadedById_uploadKey: {
            taskId,
            uploadedById: identity.user.id,
            uploadKey,
          },
        },
      });
      if (existing) {
        if (
          existing.removedAt ||
          existing.fileName !== validated.fileName ||
          existing.sha256 !== received.sha256 ||
          existing.mimeType !== validated.mimeType
        )
          throw new SetupError(
            409,
            "UPLOAD_KEY_REUSED",
            "This upload was already used for another file. Choose the file again.",
          );
        return {
          id: existing.id,
          taskId,
          boardId: current.task.boardId,
          storageKey: existing.storageKey,
        };
      }
      const file = await tx.taskAttachment.create({
        data: {
          taskId,
          uploadedById: identity.user.id,
          uploadKey,
          ...received,
          ...validated,
          storageProvider: location.storageProvider,
          storageBucket: location.storageBucket,
        },
      });
      await tx.boardEvent.create({
        data: {
          boardId: current.task.boardId,
          actorId: identity.user.id,
          action: "Uploaded task attachment",
          subjectId: file.id,
          after: { taskId, fileName: file.fileName, sizeBytes: file.sizeBytes },
        },
      });
      return {
        id: file.id,
        taskId,
        boardId: current.task.boardId,
        storageKey: file.storageKey,
      };
    });
    retained = result.storageKey === received.storageKey;
    return { id: result.id, taskId, boardId: result.boardId };
  } finally {
    if (!retained || location.storageProvider === "S3")
      await discardAttachment(received.storageKey).catch(() => {
        console.error(
          JSON.stringify({
            event: "attachment_staging_cleanup_pending",
            storageKey: received.storageKey,
          }),
        );
      });
    if (!retained && remoteAttempted) {
      await discardAttachmentObject(location).catch(() => {
        console.error(
          JSON.stringify({
            event: "attachment_cleanup_pending",
            storageKey: received.storageKey,
          }),
        );
      });
    }
  }
}

export async function downloadAttachment(id: string, headers: Headers) {
  recordId.parse(id);
  const { user } = await requireIdentity(headers);
  return getDatabase().$transaction(async (tx) => {
    const file = await tx.taskAttachment.findUnique({ where: { id } });
    if (!file || file.removedAt) throw missing();
    await taskAccess(tx, user.id, file.taskId);
    return file;
  });
}

export async function removeAttachment(id: string, headers: Headers) {
  recordId.parse(id);
  const { user } = await requireIdentity(headers);
  const result = await serial(async (tx) => {
    const file = await tx.taskAttachment.findUnique({ where: { id } });
    if (!file) throw missing();
    const context = await taskAccess(tx, user.id, file.taskId, true);
    allowWrite(context);
    if (file.uploadedById !== user.id && !context.canManage)
      throw new SetupError(
        403,
        "FORBIDDEN",
        "Only this uploader or a board manager can remove the file.",
      );
    if (!file.removedAt) {
      await tx.taskAttachment.update({
        where: { id },
        data: { removedAt: new Date() },
      });
      await tx.boardEvent.create({
        data: {
          boardId: context.task.boardId,
          actorId: user.id,
          subjectId: id,
          action: "Removed task attachment",
          after: { taskId: file.taskId, fileName: file.fileName },
        },
      });
    }
    return {
      id,
      taskId: file.taskId,
      boardId: context.task.boardId,
      storageKey: file.storageKey,
      storageProvider: file.storageProvider,
      storageBucket: file.storageBucket,
    };
  });
  // Visibility changes atomically; a failed physical cleanup remains retryable.
  try {
    await discardAttachmentObject(result);
  } catch {
    console.error(
      JSON.stringify({
        event: "attachment_cleanup_pending",
        attachmentId: result.id,
      }),
    );
  }
  return { id, taskId: result.taskId, boardId: result.boardId };
}
