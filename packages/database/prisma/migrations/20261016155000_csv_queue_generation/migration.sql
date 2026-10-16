ALTER TABLE "CsvTransfer" ADD COLUMN "queueId" TEXT;
UPDATE "CsvTransfer" SET "queueId" = "id";
ALTER TABLE "CsvTransfer" ALTER COLUMN "queueId" SET NOT NULL;
CREATE UNIQUE INDEX "CsvTransfer_queueId_key" ON "CsvTransfer"("queueId");
