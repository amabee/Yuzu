-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "recordConfig" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "recordType" TEXT NOT NULL DEFAULT 'TASK';

-- AlterTable
ALTER TABLE "InstallationSettings" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'PHP';
