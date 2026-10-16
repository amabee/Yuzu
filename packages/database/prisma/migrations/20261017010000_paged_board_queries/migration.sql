CREATE EXTENSION IF NOT EXISTS pg_trgm;
DROP INDEX IF EXISTS "Task_boardId_archivedAt_createdAt_idx";
CREATE INDEX "Task_boardId_archivedAt_createdAt_id_idx" ON "Task"("boardId", "archivedAt", "createdAt", "id");
CREATE INDEX "Task_boardId_archivedAt_dueDate_id_idx" ON "Task"("boardId", "archivedAt", "dueDate", "id");
CREATE INDEX "Task_name_trgm_idx" ON "Task" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Task_description_trgm_idx" ON "Task" USING GIN ("description" gin_trgm_ops);
