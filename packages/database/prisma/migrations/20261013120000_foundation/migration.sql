CREATE TYPE "SetupState" AS ENUM ('UNCLAIMED', 'OWNER_CREATED', 'EMAIL_VERIFIED', 'READY');

CREATE TABLE "InstallationSettings" (
    "id" TEXT NOT NULL DEFAULT 'installation',
    "name" TEXT NOT NULL DEFAULT 'Yuzu',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "defaultDateFormat" TEXT NOT NULL DEFAULT 'dd MMM yyyy',
    "maxAttachmentSizeBytes" INTEGER NOT NULL DEFAULT 50000000,
    "allowedAttachmentMimeTypes" TEXT[] DEFAULT ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']::TEXT[],
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "setupState" "SetupState" NOT NULL DEFAULT 'UNCLAIMED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "InstallationSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InstallationSettings_singleton" CHECK ("id" = 'installation'),
    CONSTRAINT "InstallationSettings_positive_upload_limit" CHECK ("maxAttachmentSizeBytes" > 0),
    CONSTRAINT "InstallationSettings_positive_revision" CHECK ("revision" > 0)
);
