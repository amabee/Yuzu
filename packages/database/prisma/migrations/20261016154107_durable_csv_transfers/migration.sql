-- CreateTable
CREATE TABLE "CsvTransfer" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "total" INTEGER NOT NULL,
    "done" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL,
    "error" TEXT,
    "filename" TEXT,
    "outputKey" TEXT,
    "enqueuedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "dismissedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CsvTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsvTransferChunk" (
    "transferId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,

    CONSTRAINT "CsvTransferChunk_pkey" PRIMARY KEY ("transferId","index")
);

-- CreateTable
CREATE TABLE "CsvTransferRow" (
    "transferId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "taskId" TEXT,
    "proposalId" TEXT,
    "message" TEXT,

    CONSTRAINT "CsvTransferRow_pkey" PRIMARY KEY ("transferId","row")
);

-- CreateIndex
CREATE INDEX "CsvTransfer_ownerId_dismissedAt_createdAt_idx" ON "CsvTransfer"("ownerId", "dismissedAt", "createdAt");

-- CreateIndex
CREATE INDEX "CsvTransfer_status_enqueuedAt_idx" ON "CsvTransfer"("status", "enqueuedAt");

-- AddForeignKey
ALTER TABLE "CsvTransfer" ADD CONSTRAINT "CsvTransfer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsvTransfer" ADD CONSTRAINT "CsvTransfer_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsvTransferChunk" ADD CONSTRAINT "CsvTransferChunk_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "CsvTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsvTransferRow" ADD CONSTRAINT "CsvTransferRow_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "CsvTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
