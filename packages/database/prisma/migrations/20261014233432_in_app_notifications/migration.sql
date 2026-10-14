-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('ASSIGNMENT', 'APPROVAL_REQUEST', 'APPROVAL_DECISION');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "taskId" TEXT,
    "proposalId" TEXT,
    "kind" "NotificationKind" NOT NULL,
    "message" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_id_idx" ON "Notification"("recipientId", "readAt", "id");

-- CreateIndex
CREATE INDEX "Notification_boardId_idx" ON "Notification"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_recipientId_eventKey_key" ON "Notification"("recipientId", "eventKey");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "BoardProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
