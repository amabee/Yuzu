-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('TASK', 'DEAL_STAGE');

-- AlterEnum (PostgreSQL 12+ adds several values in one transaction.)
ALTER TYPE "ProposalStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "ProposalStatus" ADD VALUE 'INVALIDATED';
ALTER TYPE "ProposalStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN     "stageApproval" TEXT NOT NULL DEFAULT 'CLOSING';

-- AlterTable
ALTER TABLE "BoardProposal" ADD COLUMN     "dependencies" JSONB,
ADD COLUMN     "expiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "kind" "ProposalKind" NOT NULL DEFAULT 'TASK';

-- AlterTable
ALTER TABLE "DealStageEvent" ADD COLUMN     "requestedById" TEXT;

-- CreateIndex
CREATE INDEX "BoardProposal_kind_status_expiresAt_idx" ON "BoardProposal"("kind", "status", "expiresAt");

-- Rules Prisma can't express.

ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_stage_approval_check"
  CHECK ("stageApproval" IN ('CLOSING', 'ALL'));

-- A stage request is an update that moves one deal's stage (with an optional
-- reason), carries its dependency snapshot and expires.
ALTER TABLE "BoardProposal" ADD CONSTRAINT "BoardProposal_stage_request_check"
  CHECK (
    "kind" <> 'DEAL_STAGE' OR (
      "operation" = 'UPDATE'
      AND "dependencies" IS NOT NULL
      AND "expiresAt" IS NOT NULL
      AND "parentTaskId" IS NULL
      AND jsonb_typeof("changes" -> 'stageId') = 'string'
      AND ("changes" - 'stageId' - 'stageReason') = '{}'::jsonb
    )
  );
-- While it waits it names its deal (erasing a deal nulls only closed ones).
ALTER TABLE "BoardProposal" ADD CONSTRAINT "BoardProposal_stage_request_deal_check"
  CHECK ("kind" <> 'DEAL_STAGE' OR "status" <> 'PENDING' OR "taskId" IS NOT NULL);
-- One waiting stage request per deal, whoever asks and however.
CREATE UNIQUE INDEX "BoardProposal_one_pending_stage_request"
  ON "BoardProposal" ("taskId")
  WHERE "kind" = 'DEAL_STAGE' AND "status" = 'PENDING';
