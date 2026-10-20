-- CreateTable
CREATE TABLE "RecordLink" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordLink_fieldId_toId_idx" ON "RecordLink"("fieldId", "toId");

-- CreateIndex
CREATE INDEX "RecordLink_toId_idx" ON "RecordLink"("toId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordLink_fieldId_fromId_toId_key" ON "RecordLink"("fieldId", "fromId", "toId");

-- AddForeignKey
ALTER TABLE "RecordLink" ADD CONSTRAINT "RecordLink_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "BoardColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordLink" ADD CONSTRAINT "RecordLink_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordLink" ADD CONSTRAINT "RecordLink_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
