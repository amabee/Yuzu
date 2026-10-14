ALTER TABLE "InstallationSettings" ADD COLUMN "theme" JSONB, ADD COLUMN "themeDraft" JSONB, ADD COLUMN "previousTheme" JSONB, ADD COLUMN "themeRevision" INTEGER NOT NULL DEFAULT 0;
