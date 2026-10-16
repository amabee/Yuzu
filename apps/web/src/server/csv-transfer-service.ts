import { z } from "zod";
import { createRecordId, getDatabase } from "@yuzu/database";
import { putCsvObject, getCsvObject } from "@yuzu/database/csv-objects";
import { access, serial } from "./board-service";
import { requireIdentity } from "./team-access";
import { readTicket } from "./csv-import-service";
import { SetupError, digest } from "./setup/security";
import {
  transferCreateSchema,
  transferActionSchema,
  activeTransfer,
} from "@/lib/csv-transfer-contract";

import { stableJson } from "@/lib/approval-rules";

const unavailable = () =>
  new SetupError(404, "NOT_FOUND", "This transfer is not available to you.");
export async function ownedTransfer(id: string, headers: Headers) {
  z.string().uuid().parse(id);
  const { user } = await requireIdentity(headers, { allowMaintenance: true });
  const job = await getDatabase().csvTransfer.findFirst({
    where: { id, ownerId: user.id },
  });
  if (!job) throw unavailable();
  await getDatabase().$transaction((tx) => access(tx, user.id, job.boardId));
  return job;
}
export async function listTransfers(headers: Headers) {
  const { user } = await requireIdentity(headers, { allowMaintenance: true });
  const jobs = await getDatabase().csvTransfer.findMany({
    where: {
      ownerId: user.id,
      dismissedAt: null,
      expiresAt: { gt: new Date() },
      board: {
        workspace:
          user.role === "OWNER" || user.role === "ADMIN"
            ? {}
            : { members: { some: { userId: user.id } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return Promise.all(
    jobs.map(async (job) => {
      const counts = await getDatabase().csvTransferRow.groupBy({
        by: ["outcome"],
        where: { transferId: job.id },
        _count: true,
      });
      return {
        id: job.id,
        boardId: job.boardId,
        kind: job.kind,
        name: job.name,
        status: job.status,
        total: job.total,
        done: job.done,
        chunkCount: job.chunkCount,
        error: job.error,
        filename: job.filename,
        createdAt: job.createdAt.toISOString(),
        expiresAt: job.expiresAt.toISOString(),
        summary: Object.fromEntries(
          counts.map((item) => [item.outcome, item._count]),
        ),
      };
    }),
  );
}
export async function createTransfer(input: unknown, headers: Headers) {
  const body = transferCreateSchema.parse(input);
  const { user } = await requireIdentity(headers);
  const boardId = body.kind === "IMPORT" ? body.boardId : body.input.boardId;
  return serial(async (tx) => {
    await access(tx, user.id, boardId, true);
    const existing = await tx.csvTransfer.findUnique({
      where: { id: body.id },
    });
    if (existing) {
      if (
        existing.ownerId !== user.id ||
        existing.boardId !== boardId ||
        stableJson(existing.config) !== stableJson(body)
      )
        throw new SetupError(
          409,
          "REQUEST_CHANGED",
          "This transfer ID belongs to another request.",
        );
      return { id: existing.id };
    }
    const active = await tx.csvTransfer.count({
      where: {
        ownerId: user.id,
        status: { in: ["UPLOADING", "QUEUED", "RUNNING"] },
        expiresAt: { gt: new Date() },
      },
    });
    const recent = await tx.csvTransfer.count({
      where: {
        ownerId: user.id,
        createdAt: { gt: new Date(Date.now() - 86_400_000) },
      },
    });
    if (active >= 3 || recent >= 100)
      throw new SetupError(
        429,
        "TRANSFER_LIMIT",
        "Finish an active transfer or try again later.",
      );
    await tx.csvTransfer.create({
      data: {
        id: body.id,
        ownerId: user.id,
        boardId,
        kind: body.kind,
        name: body.kind === "IMPORT" ? body.name : "Board export",
        status: body.kind === "IMPORT" ? "UPLOADING" : "QUEUED",
        total: body.kind === "IMPORT" ? body.total : 0,
        chunkCount: body.kind === "IMPORT" ? body.chunkCount : 0,
        config: body,
        expiresAt: new Date(
          Date.now() + (body.kind === "EXPORT" ? 7 : 1) * 86_400_000,
        ),
      },
    });
    return { id: body.id };
  });
}
export async function changeTransfer(
  id: string,
  input: unknown,
  headers: Headers,
) {
  const body = transferActionSchema.parse(input);
  const job = await ownedTransfer(id, headers);
  if (job.expiresAt < new Date())
    throw new SetupError(
      410,
      "EXPIRED",
      "This transfer expired. Start a new transfer.",
    );
  if (body.action === "chunk") {
    if (
      job.kind !== "IMPORT" ||
      job.status !== "UPLOADING" ||
      body.index >= job.chunkCount
    )
      throw new SetupError(
        409,
        "TRANSFER_CHANGED",
        "This transfer no longer accepts upload chunks.",
      );
    const rows = body.rows.map((row) => {
      const ticket = readTicket(row.token);
      if (
        ticket.actorId !== job.ownerId ||
        ticket.input.boardId !== job.boardId
      )
        throw new SetupError(
          403,
          "IMPORT_OWNER",
          "Use a preview created by your account for this board.",
        );
      return {
        row: row.row,
        input: ticket.input,
        allowDuplicate: row.allowDuplicate,
        ...(ticket.sourceId ? { sourceId: ticket.sourceId } : {}),
      };
    });
    const bytes = Buffer.from(JSON.stringify(rows));
    if (
      bytes.length > 3_000_000 ||
      new Set(rows.map((row) => row.row)).size !== rows.length
    )
      throw new SetupError(
        422,
        "INVALID_CHUNK",
        "Choose smaller chunks with unique CSV row numbers.",
      );
    const hash = digest(bytes.toString("utf8"));
    const key = `csv-jobs/${id}/chunk-${body.index}-${hash}.json`;
    // Reject changed chunks and exhausted quotas before writing storage, then recheck
    // in the commit transaction to account for concurrent requests.
    await serial(async (tx) => {
      await access(tx, job.ownerId, job.boardId, true);
      const prior = await tx.csvTransferChunk.findUnique({
        where: { transferId_index: { transferId: id, index: body.index } },
      });
      if (prior) {
        if (prior.digest !== hash)
          throw new SetupError(
            409,
            "CHUNK_CHANGED",
            "This chunk has different content.",
          );
        return;
      }
      const size = await tx.csvTransferChunk.aggregate({
        where: { transferId: id },
        _sum: { bytes: true, count: true },
      });
      if (
        (size._sum.bytes ?? 0) + bytes.length > 80_000_000 ||
        (size._sum.count ?? 0) + rows.length > job.total
      )
        throw new SetupError(
          413,
          "TRANSFER_TOO_LARGE",
          "This import exceeds its staging limit.",
        );
    });
    // Content-addressed writes make a lost response safe to retry.
    await putCsvObject(key, bytes);
    await serial(async (tx) => {
      await access(tx, job.ownerId, job.boardId, true);
      const current = await tx.csvTransfer.findUniqueOrThrow({ where: { id } });
      if (current.status !== "UPLOADING")
        throw new SetupError(
          409,
          "TRANSFER_CHANGED",
          "This upload has already finished.",
        );
      const prior = await tx.csvTransferChunk.findUnique({
        where: { transferId_index: { transferId: id, index: body.index } },
      });
      if (prior) {
        if (prior.digest !== hash)
          throw new SetupError(
            409,
            "CHUNK_CHANGED",
            "This chunk has different content.",
          );
        return;
      }
      const size = await tx.csvTransferChunk.aggregate({
        where: { transferId: id },
        _sum: { bytes: true, count: true },
      });
      if (
        (size._sum.bytes ?? 0) + bytes.length > 80_000_000 ||
        (size._sum.count ?? 0) + rows.length > job.total
      )
        throw new SetupError(
          413,
          "TRANSFER_TOO_LARGE",
          "This import exceeds its staging limit.",
        );
      await tx.csvTransferChunk.create({
        data: {
          transferId: id,
          index: body.index,
          count: rows.length,
          bytes: bytes.length,
          digest: hash,
          objectKey: key,
        },
      });
      await tx.csvTransfer.update({
        where: { id },
        data: { done: { increment: rows.length } },
      });
    });
  } else if (body.action === "start") {
    await serial(async (tx) => {
      await access(tx, job.ownerId, job.boardId, true);
      const current = await tx.csvTransfer.findUniqueOrThrow({ where: { id } });
      if (current.status !== "UPLOADING") return;
      const chunks = await tx.csvTransferChunk.aggregate({
        where: { transferId: id },
        _count: true,
        _sum: { count: true },
      });
      if (chunks._count !== job.chunkCount || chunks._sum.count !== job.total)
        throw new SetupError(
          409,
          "UPLOAD_INCOMPLETE",
          "Finish uploading all chunks before importing.",
        );
      await tx.csvTransfer.update({
        where: { id },
        data: {
          status: "QUEUED",
          done: 0,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });
    });
  } else if (body.action === "retry") {
    // Row failures retain their result report; service interruptions resume the same idempotent job.
    if (job.status !== "FAILED" && job.status !== "COMPLETED")
      throw new SetupError(
        409,
        "TRANSFER_CHANGED",
        "Only failed transfers can be retried.",
      );
    await serial(async (tx) => {
      await access(tx, job.ownerId, job.boardId, true);
      const current = await tx.csvTransfer.findUniqueOrThrow({ where: { id } });
      if (!["FAILED", "COMPLETED"].includes(current.status))
        throw new SetupError(
          409,
          "TRANSFER_CHANGED",
          "This transfer is already running.",
        );
      await tx.csvTransferRow.deleteMany({
        where: { transferId: id, outcome: "FAILED" },
      });
      const done = await tx.csvTransferRow.count({ where: { transferId: id } });
      await tx.csvTransfer.update({
        where: { id },
        data: {
          status: "QUEUED",
          queueId: createRecordId(),
          done,
          enqueuedAt: null,
          error: null,
          finishedAt: null,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });
    });
  } else if (body.action === "dismiss") {
    if (activeTransfer(job.status))
      throw new SetupError(
        409,
        "TRANSFER_ACTIVE",
        "Active transfers cannot be dismissed.",
      );
    await getDatabase().csvTransfer.update({
      where: { id },
      data: { dismissedAt: new Date() },
    });
  } else {
    await getDatabase().csvTransfer.updateMany({
      where: { id, status: { in: ["UPLOADING", "QUEUED", "RUNNING"] } },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });
  }
  return { id };
}
export async function transferDetail(id: string, headers: Headers) {
  const job = await ownedTransfer(id, headers);
  return {
    status: job.status,
    uploaded: (
      await getDatabase().csvTransferChunk.findMany({
        where: { transferId: id },
        select: { index: true },
      })
    ).map((item) => item.index),
  };
}
export async function transferDownload(
  id: string,
  headers: Headers,
  report = false,
) {
  const job = await ownedTransfer(id, headers);
  if (job.expiresAt < new Date())
    throw new SetupError(410, "EXPIRED", "This download expired.");
  if (report && job.kind === "IMPORT") {
    const { csvLine } = await import("@/lib/csv-export");
    const rows = await getDatabase().csvTransferRow.findMany({
      where: { transferId: id },
      orderBy: { row: "asc" },
    });
    return {
      filename: "yuzu-import-results.csv",
      bytes: Buffer.from(
        "\ufeff" +
          csvLine(["Row", "Outcome", "Task ID", "Approval ID", "Message"]) +
          rows
            .map((row) =>
              csvLine([
                String(row.row),
                row.outcome,
                row.taskId ?? "",
                row.proposalId ?? "",
                row.message ?? "",
              ]),
            )
            .join(""),
      ),
    };
  }
  if (
    job.kind !== "EXPORT" ||
    job.status !== "COMPLETED" ||
    !job.outputKey ||
    !job.filename
  )
    throw new SetupError(
      409,
      "NOT_READY",
      "Your export is not ready to download.",
    );
  const bytes = await getCsvObject(job.outputKey, 10_000_000);
  // Access may have been revoked while storage was responding.
  await ownedTransfer(id, headers);
  return { filename: job.filename, bytes };
}
