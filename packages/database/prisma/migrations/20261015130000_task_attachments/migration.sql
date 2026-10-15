CREATE TABLE "TaskAttachment" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "uploadKey" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMPTZ(3),
  CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaskAttachment_sizeBytes_check" CHECK ("sizeBytes" > 0),
  CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TaskAttachment_storageKey_key" ON "TaskAttachment"("storageKey");
CREATE UNIQUE INDEX "TaskAttachment_taskId_uploadedById_uploadKey_key" ON "TaskAttachment"("taskId", "uploadedById", "uploadKey");
CREATE INDEX "TaskAttachment_taskId_removedAt_createdAt_idx" ON "TaskAttachment"("taskId", "removedAt", "createdAt");
