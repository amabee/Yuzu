-- CreateEnum
CREATE TYPE "ApprovalOperation" AS ENUM ('CREATE', 'UPDATE', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'STALE');

-- AlterTable
ALTER TABLE "BoardEvent" ADD COLUMN     "after" JSONB,
ADD COLUMN     "before" JSONB;

-- CreateTable
CREATE TABLE "BoardApprovalPolicy" (
    "boardId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "requireCreation" BOOLEAN NOT NULL DEFAULT false,
    "requireChanges" BOOLEAN NOT NULL DEFAULT true,
    "requireArchive" BOOLEAN NOT NULL DEFAULT false,
    "protectedFieldIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primaryApproverId" TEXT,
    "backupApproverId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BoardApprovalPolicy_pkey" PRIMARY KEY ("boardId")
);

-- CreateTable
CREATE TABLE "BoardProposal" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "taskId" TEXT,
    "authorId" TEXT NOT NULL,
    "operation" "ApprovalOperation" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "requestKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "baseline" JSONB NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "sourceRevision" INTEGER,
    "appliedRevision" INTEGER,
    "decidedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BoardProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardProposal_boardId_status_createdAt_idx" ON "BoardProposal"("boardId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BoardProposal_authorId_status_createdAt_idx" ON "BoardProposal"("authorId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BoardProposal_authorId_requestKey_key" ON "BoardProposal"("authorId", "requestKey");

-- AddForeignKey
ALTER TABLE "BoardApprovalPolicy" ADD CONSTRAINT "BoardApprovalPolicy_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardApprovalPolicy" ADD CONSTRAINT "BoardApprovalPolicy_primaryApproverId_fkey" FOREIGN KEY ("primaryApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardApprovalPolicy" ADD CONSTRAINT "BoardApprovalPolicy_backupApproverId_fkey" FOREIGN KEY ("backupApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardProposal" ADD CONSTRAINT "BoardProposal_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardProposal" ADD CONSTRAINT "BoardProposal_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardProposal" ADD CONSTRAINT "BoardProposal_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardProposal" ADD CONSTRAINT "BoardProposal_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
