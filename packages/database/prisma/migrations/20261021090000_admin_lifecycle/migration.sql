-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deactivatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "deactivatedById" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectId" TEXT,
    "workspaceId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_deactivatedById_fkey" FOREIGN KEY ("deactivatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry earlier access records into the audit log.
INSERT INTO "AuditEvent" ("id", "actorId", "action", "subject", "workspaceId", "createdAt")
SELECT "id", "actorId", "action", "subjectEmail", "workspaceId", "createdAt" FROM "AccessEvent";
