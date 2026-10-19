-- CreateEnum
CREATE TYPE "EmailDelivery" AS ENUM ('INSTANT', 'DIGEST', 'OFF');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "digestTime" TEXT DEFAULT '08:00',
ADD COLUMN     "lastDigestAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "delivery" "EmailDelivery" NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId","kind")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "notificationId" TEXT,
    "subject" TEXT,
    "html" TEXT,
    "text" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "sendAfter" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailMessage_status_sendAfter_idx" ON "EmailMessage"("status", "sendAfter");

-- CreateIndex
CREATE INDEX "EmailMessage_userId_sentAt_idx" ON "EmailMessage"("userId", "sentAt");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

