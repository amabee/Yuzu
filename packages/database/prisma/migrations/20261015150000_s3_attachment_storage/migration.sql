ALTER TABLE "TaskAttachment" ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'LOCAL',
ADD COLUMN "storageBucket" TEXT;
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_storage_location_check"
CHECK (("storageProvider" = 'LOCAL' AND "storageBucket" IS NULL) OR
       ("storageProvider" = 'S3' AND "storageBucket" IS NOT NULL AND length("storageBucket") > 0));
