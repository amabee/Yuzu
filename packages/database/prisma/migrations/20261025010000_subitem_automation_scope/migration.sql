ALTER TABLE "AutomationRule" ADD COLUMN "recordScope" TEXT NOT NULL DEFAULT 'ROOTS';
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_recordScope_check" CHECK ("recordScope" IN ('ROOTS','SUBITEMS','BOTH'));
