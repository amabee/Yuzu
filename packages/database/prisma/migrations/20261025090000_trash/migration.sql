-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "deletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "InstallationSettings" ADD COLUMN     "trashRetentionDays" INTEGER;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "deletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "deletedById" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "deletedAt" TIMESTAMPTZ(3),
ADD COLUMN     "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");
