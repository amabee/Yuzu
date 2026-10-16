import { PgBoss } from "pg-boss";
import { z } from "zod";
import { createRecordId, getDatabase } from "@yuzu/database";
import {
  getCsvObject,
  putCsvObject,
  deleteCsvObject,
  staleCsvObjects,
} from "@yuzu/database/csv-objects";
import { createTaskInTransaction, serial, access } from "./board-service";
import { exportBoardCsvForActor } from "./csv-export-service";
import { SetupError, digest } from "./setup/security";
import { stagedRowSchema } from "@/lib/csv-transfer-contract";
import { signRealtimeToken } from "@yuzu/realtime-protocol";
import { notifyBoardMutation } from "./realtime";

const queueName = "yuzu-csv";
const db = getDatabase;
export async function signalTransfer(
  job: { id: string; boardId: string; ownerId: string },
  boardChanged = false,
) {
  if (boardChanged) {
    // Reuse recipient fan-out so imported assignments and approval requests also refresh inboxes.
    await notifyBoardMutation({
      boardId: job.boardId,
      userId: job.ownerId,
      createKey: job.id,
    });
    return;
  }
  const secret = process.env.REALTIME_SECRET,
    url = process.env.REALTIME_INTERNAL_URL;
  if (!secret || !url) return;
  try {
    await fetch(new URL("/events", url), {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: signRealtimeToken(
        {
          purpose: "event",
          boardId: job.boardId,
          userIds: [job.ownerId],
          notifyBoard: boardChanged,
          eventId: createRecordId(),
          expiresAt: Date.now() + 10_000,
        },
        secret,
      ),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    /* Saved progress remains available through the API. */
  }
}
export async function processCsvTransfer(id: string, signal?: AbortSignal) {
  const job = await db().csvTransfer.findUnique({
    where: { id },
    include: { chunks: { orderBy: { index: "asc" } } },
  });
  if (!job || !["QUEUED", "RUNNING"].includes(job.status)) return;
  if (job.expiresAt < new Date())
    throw new SetupError(
      410,
      "EXPIRED",
      "This transfer expired. Start a new transfer.",
    );
  await db().$transaction((tx) => access(tx, job.ownerId, job.boardId, true));
  await db().csvTransfer.updateMany({
    where: { id, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "RUNNING", error: null },
  });
  await signalTransfer(job);
  if (job.kind === "EXPORT") {
    const result = await exportBoardCsvForActor(
      (job.config as { input: unknown }).input,
      job.ownerId,
      signal,
    );
    signal?.throwIfAborted();
    const key = `csv-jobs/${id}/export-${job.queueId}.csv`;
    await putCsvObject(key, Buffer.from(result.csv));
    await db().$transaction(async (tx) => {
      await access(tx, job.ownerId, job.boardId);
      await tx.csvTransfer.updateMany({
        where: { id, queueId: job.queueId, status: "RUNNING" },
        data: {
          status: "COMPLETED",
          outputKey: key,
          filename: result.filename,
          done: result.rowCount,
          total: result.rowCount,
          finishedAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    });
    await signalTransfer(job);
    return;
  }
  let sinceUpdate = 0,
    lastUpdate = Date.now();
  const publish = async () => {
    const done = await db().csvTransferRow.count({ where: { transferId: id } });
    await db().csvTransfer.updateMany({
      where: {
        id,
        queueId: job.queueId,
        status: { in: ["RUNNING", "CANCELLED"] },
      },
      data: { done },
    });
    await signalTransfer(job, true);
    sinceUpdate = 0;
    lastUpdate = Date.now();
  };
  const seenRows = new Set<number>();
  // Validate the whole manifest before any writes, including cross-chunk row identities.
  for (const chunk of job.chunks) {
    signal?.throwIfAborted();
    const bytes = await getCsvObject(chunk.objectKey);
    if (digest(bytes.toString("utf8")) !== chunk.digest)
      throw new Error("CSV staging checksum mismatch.");
    const rows = z
      .array(stagedRowSchema)
      .parse(JSON.parse(bytes.toString("utf8")));
    if (rows.length !== chunk.count)
      throw new Error("CSV staging count mismatch.");
    for (const row of rows) {
      if (row.input.boardId !== job.boardId || seenRows.has(row.row))
        throw new SetupError(
          422,
          "INVALID_MANIFEST",
          "This import contains repeated or invalid rows. Start a new import.",
        );
      seenRows.add(row.row);
    }
  }
  if (seenRows.size !== job.total)
    throw new Error("CSV staging is incomplete.");
  for (const chunk of job.chunks) {
    const rows = z
      .array(stagedRowSchema)
      .parse(
        JSON.parse((await getCsvObject(chunk.objectKey)).toString("utf8")),
      );
    for (const row of rows) {
      const current = await db().csvTransfer.findUnique({
        where: { id },
        select: { status: true, queueId: true },
      });
      signal?.throwIfAborted();
      if (current?.status !== "RUNNING" || current.queueId !== job.queueId) {
        await publish();
        return;
      }
      try {
        await serial(async (tx) => {
          // A row's task/proposal and checkpoint commit together.
          const prior = await tx.csvTransferRow.findUnique({
            where: { transferId_row: { transferId: id, row: row.row } },
          });
          if (prior) return;
          const result = await createTaskInTransaction(
            tx,
            row.input,
            job.ownerId,
            { skipDuplicate: !row.allowDuplicate, sourceId: row.sourceId },
          );
          await tx.csvTransferRow.create({
            data: {
              transferId: id,
              row: row.row,
              outcome: result.outcome,
              taskId: result.taskId,
              proposalId: result.proposalId,
            },
          });
        });
      } catch (error) {
        if (
          !(error instanceof SetupError) ||
          ![409, 422].includes(error.status) ||
          error.code === "CONCURRENT_CHANGE"
        )
          throw error;
        await db().csvTransferRow.upsert({
          where: { transferId_row: { transferId: id, row: row.row } },
          update: {},
          create: {
            transferId: id,
            row: row.row,
            outcome: error.code === "IMPORT_DUPLICATE" ? "SKIPPED" : "FAILED",
            message: error.message,
          },
        });
      }
      sinceUpdate++;
      if (sinceUpdate >= 25 || Date.now() - lastUpdate >= 1000) await publish();
    }
  }
  await publish();
  await db().csvTransfer.updateMany({
    where: { id, queueId: job.queueId, status: "RUNNING" },
    data: {
      status: "COMPLETED",
      finishedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  await signalTransfer(job, true);
}

export async function startCsvWorker() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for the CSV worker.");
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    superviseIntervalSeconds: 5,
  });
  boss.on("error", () =>
    console.error(JSON.stringify({ event: "csv_queue_error" })),
  );
  await boss.start();
  await boss.createQueue(queueName, {
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 3600,
    heartbeatSeconds: 30,
    retentionSeconds: 172800,
  });
  await boss.work<{ id: string; generation: string }>(
    queueName,
    { localConcurrency: 2, groupConcurrency: 1, includeMetadata: true },
    async ([queued]) => {
      const job = await db().csvTransfer.findUnique({
        where: { id: queued.data.id },
      });
      if (!job || job.queueId !== queued.data.generation) return;
      try {
        await processCsvTransfer(job.id, queued.signal);
      } catch (error) {
        const permanent =
          error instanceof SetupError &&
          [403, 404, 410, 413, 422].includes(error.status);
        const terminal =
          permanent ||
          ("retryCount" in queued ? Number(queued.retryCount) : 0) >= 3;
        await db().csvTransfer.updateMany({
          where: {
            id: job.id,
            queueId: queued.data.generation,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          data: {
            ...(terminal ? { status: "FAILED", finishedAt: new Date() } : {}),
            error:
              error instanceof SetupError
                ? error.message
                : "Processing was interrupted. Yuzu will retry; you can retry manually if it fails.",
          },
        });
        await signalTransfer(job, true);
        if (!permanent) throw error;
      }
    },
  );
  let running = false,
    stopped = false,
    lastCleanup = 0,
    lastSweep = 0;
  async function dispatch() {
    if (running || stopped) return;
    running = true;
    try {
      const jobs = await db().csvTransfer.findMany({
        where: { status: "QUEUED", enqueuedAt: null },
        take: 50,
      });
      for (const job of jobs) {
        await boss.send(
          queueName,
          { id: job.id, generation: job.queueId },
          { id: job.queueId, group: { id: job.boardId } },
        );
        await db().csvTransfer.updateMany({
          where: { id: job.id, queueId: job.queueId },
          data: { enqueuedAt: new Date() },
        });
      }
      // Reconcile exhausted jobs even if the process died on its last attempt.
      const active = await db().csvTransfer.findMany({
        where: {
          status: { in: ["QUEUED", "RUNNING"] },
          enqueuedAt: { not: null },
        },
        take: 100,
      });
      for (const job of active) {
        const queueJob = await boss.getJobById(queueName, job.queueId);
        if (
          !queueJob &&
          job.enqueuedAt &&
          Date.now() - job.enqueuedAt.getTime() > 60_000
        ) {
          await db().csvTransfer.updateMany({
            where: {
              id: job.id,
              queueId: job.queueId,
              status: { in: ["QUEUED", "RUNNING"] },
            },
            data: {
              status: "QUEUED",
              queueId: createRecordId(),
              enqueuedAt: null,
            },
          });
        }
        if (queueJob && ["failed", "cancelled"].includes(queueJob.state)) {
          await db().csvTransfer.updateMany({
            where: {
              id: job.id,
              queueId: job.queueId,
              status: { in: ["QUEUED", "RUNNING"] },
            },
            data: {
              status: "FAILED",
              error:
                "The worker could not finish this transfer. Retry to resume saved progress.",
              finishedAt: new Date(),
            },
          });
          await signalTransfer(job);
        }
      }
      if (Date.now() - lastCleanup > 60_000) {
        lastCleanup = Date.now();
        const expired = await db().csvTransfer.findMany({
          where: { expiresAt: { lt: new Date() } },
          include: { chunks: true },
          take: 50,
        });
        for (const job of expired) {
          if (["QUEUED", "RUNNING"].includes(job.status)) continue;
          for (const key of [
            ...job.chunks.map((chunk) => chunk.objectKey),
            ...(job.outputKey ? [job.outputKey] : []),
          ])
            await deleteCsvObject(key);
          await db().csvTransfer.delete({ where: { id: job.id } });
        }
      }
      if (Date.now() - lastSweep > 3_600_000) {
        lastSweep = Date.now();
        for await (const object of staleCsvObjects(
          new Date(Date.now() - 2 * 86_400_000),
        )) {
          const job = await db().csvTransfer.findUnique({
            where: { id: object.transferId },
            select: { status: true },
          });
          if (!job) await deleteCsvObject(object.key);
        }
      }
    } catch {
      console.error(JSON.stringify({ event: "csv_dispatch_error" }));
    } finally {
      running = false;
    }
  }
  await dispatch();
  const timer = setInterval(() => void dispatch(), 2000);
  return {
    boss,
    close: async () => {
      stopped = true;
      clearInterval(timer);
      await boss.stop({ graceful: true, timeout: 30_000 });
      await db().$disconnect();
    },
  };
}
