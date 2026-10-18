-- How a rule's conditions combine: "all" or "any".
ALTER TABLE "AutomationRule" ADD COLUMN "match" TEXT NOT NULL DEFAULT 'all';
