-- CreateEnum
CREATE TYPE "AutomationDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- AlterTable
ALTER TABLE "AutomationEvent" ADD COLUMN     "ruleId" TEXT,
ALTER COLUMN "taskId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "lastScheduledAt" TIMESTAMPTZ(3),
ADD COLUMN     "webhookSecret" TEXT;

-- AlterTable
ALTER TABLE "AutomationRun" ADD COLUMN     "createdTaskId" TEXT,
ALTER COLUMN "taskId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InstallationSettings" ADD COLUMN     "allowPrivateWebhooks" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AutomationDelivery" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AutomationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseCode" INTEGER,
    "durationMs" INTEGER,
    "error" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationDelivery_status_nextAttemptAt_idx" ON "AutomationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AutomationDelivery_runId_idx" ON "AutomationDelivery"("runId");

-- AddForeignKey
ALTER TABLE "AutomationDelivery" ADD CONSTRAINT "AutomationDelivery_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationDelivery" ADD CONSTRAINT "AutomationDelivery_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

