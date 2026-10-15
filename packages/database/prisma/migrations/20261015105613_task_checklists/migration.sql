-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "checklist" JSONB NOT NULL DEFAULT '[]';
