-- AlterTable
ALTER TABLE "Task" ADD COLUMN "position" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Keep today's order: number each board's tasks by creation time.
UPDATE "Task" AS t
SET "position" = ordered.rank * 1024
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "boardId" ORDER BY "createdAt", "id") AS rank
  FROM "Task"
) AS ordered
WHERE t."id" = ordered."id";

-- CreateIndex
CREATE INDEX "Task_boardId_archivedAt_position_id_idx" ON "Task"("boardId", "archivedAt", "position", "id");
