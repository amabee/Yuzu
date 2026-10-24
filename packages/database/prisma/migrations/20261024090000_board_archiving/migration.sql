ALTER TABLE "Board" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
CREATE INDEX "Board_workspaceId_archivedAt_idx" ON "Board"("workspaceId", "archivedAt");
