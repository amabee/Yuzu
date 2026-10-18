-- Tasks gain an optional start date (Timeline bars run from start to due).
ALTER TABLE "Task" ADD COLUMN "startDate" DATE;
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_startDate_before_dueDate_check"
  CHECK ("startDate" IS NULL OR "dueDate" IS NULL OR "startDate" <= "dueDate");
CREATE INDEX "Task_boardId_archivedAt_startDate_id_idx"
  ON "Task"("boardId", "archivedAt", "startDate", "id");

-- Every board gets the core "Start date" column just before "Due date".
-- Record ids are UUIDv7: a millisecond timestamp prefix over random bits.
UPDATE "BoardColumn" AS c
SET "position" = c."position" + 1
FROM "BoardColumn" AS due
WHERE due."boardId" = c."boardId"
  AND due."key" = 'due_date'
  AND c."position" >= due."position";

INSERT INTO "BoardColumn" ("id", "boardId", "key", "name", "type", "position", "config")
SELECT
  encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid::text,
  b."id",
  'start_date',
  'Start date',
  'DATE',
  COALESCE(due."position" - 1, (SELECT COALESCE(MAX(c."position"), -1) + 1 FROM "BoardColumn" c WHERE c."boardId" = b."id")),
  '{}'
FROM "Board" AS b
LEFT JOIN "BoardColumn" AS due ON due."boardId" = b."id" AND due."key" = 'due_date'
ON CONFLICT ("boardId", "key") DO NOTHING;
