-- DropIndex
DROP INDEX "TaskFieldValue_fieldId_textValue_idx";

-- CreateIndex
CREATE INDEX "TaskFieldValue_fieldId_idx" ON "TaskFieldValue"("fieldId");
