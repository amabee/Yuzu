-- First day of calendar weeks for the installation: 0 Sunday, 1 Monday.
ALTER TABLE "InstallationSettings" ADD COLUMN "weekStartsOn" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InstallationSettings"
  ADD CONSTRAINT "InstallationSettings_weekStartsOn_check" CHECK ("weekStartsOn" IN (0, 1));
