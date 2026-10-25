-- CreateTable
CREATE TABLE "Pipeline" (
    "boardId" TEXT NOT NULL,
    "defaultStageId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("boardId")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealProfile" (
    "recordId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "amount" DECIMAL(20,4),
    "currency" TEXT,
    "customerCompanyId" TEXT,
    "customerContactId" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DealProfile_pkey" PRIMARY KEY ("recordId")
);

-- CreateTable
CREATE TABLE "DealStageEvent" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStageId" TEXT,
    "fromStageName" TEXT,
    "fromCategory" TEXT,
    "toStageId" TEXT NOT NULL,
    "toStageName" TEXT NOT NULL,
    "toCategory" TEXT NOT NULL,
    "amount" DECIMAL(20,4),
    "currency" TEXT,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealStageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineStage_boardId_position_idx" ON "PipelineStage"("boardId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_boardId_id_key" ON "PipelineStage"("boardId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_boardId_key_key" ON "PipelineStage"("boardId", "key");

-- CreateIndex
CREATE INDEX "DealProfile_boardId_stageId_idx" ON "DealProfile"("boardId", "stageId");

-- CreateIndex
CREATE INDEX "DealProfile_customerCompanyId_idx" ON "DealProfile"("customerCompanyId");

-- CreateIndex
CREATE INDEX "DealProfile_customerContactId_idx" ON "DealProfile"("customerContactId");

-- CreateIndex
CREATE INDEX "DealStageEvent_dealId_createdAt_idx" ON "DealStageEvent"("dealId", "createdAt");

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Pipeline"("boardId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealProfile" ADD CONSTRAINT "DealProfile_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealProfile" ADD CONSTRAINT "DealProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealProfile" ADD CONSTRAINT "DealProfile_boardId_stageId_fkey" FOREIGN KEY ("boardId", "stageId") REFERENCES "PipelineStage"("boardId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealProfile" ADD CONSTRAINT "DealProfile_customerCompanyId_workspaceId_fkey" FOREIGN KEY ("customerCompanyId", "workspaceId") REFERENCES "CompanyProfile"("recordId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealProfile" ADD CONSTRAINT "DealProfile_customerContactId_workspaceId_fkey" FOREIGN KEY ("customerContactId", "workspaceId") REFERENCES "ContactProfile"("recordId", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealStageEvent" ADD CONSTRAINT "DealStageEvent_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Values the database keeps valid even for direct writes.
ALTER TABLE "PipelineStage"
  ADD CONSTRAINT "PipelineStage_category_check" CHECK ("category" IN ('OPEN', 'WON', 'LOST')),
  ADD CONSTRAINT "PipelineStage_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 40),
  ADD CONSTRAINT "PipelineStage_key_check" CHECK ("key" ~ '^[a-z0-9_]{1,40}$');
ALTER TABLE "DealProfile"
  ADD CONSTRAINT "DealProfile_one_customer_check" CHECK ("customerCompanyId" IS NULL OR "customerContactId" IS NULL),
  ADD CONSTRAINT "DealProfile_currency_check" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "DealProfile_amount_check" CHECK ("amount" IS NULL OR ("amount" >= 0 AND "currency" IS NOT NULL));
ALTER TABLE "DealStageEvent"
  ADD CONSTRAINT "DealStageEvent_kind_check" CHECK ("kind" IN ('CREATED', 'MOVED', 'WON', 'LOST', 'REOPENED')),
  ADD CONSTRAINT "DealStageEvent_category_check" CHECK ("toCategory" IN ('OPEN', 'WON', 'LOST') AND ("fromCategory" IS NULL OR "fromCategory" IN ('OPEN', 'WON', 'LOST')));

-- Stage history is a record of what happened; it is never rewritten.
CREATE FUNCTION yuzu_stage_events_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Deal stage history is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "DealStageEvent_immutable" BEFORE UPDATE ON "DealStageEvent" FOR EACH ROW EXECUTE FUNCTION yuzu_stage_events_immutable();

-- A pipeline belongs to a standalone DEAL board, which keeps that shape.
CREATE FUNCTION yuzu_guard_pipeline() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE kind TEXT;
DECLARE project TEXT;
BEGIN
  SELECT "recordType", "projectId" INTO kind, project FROM "Board" WHERE "id" = NEW."boardId" FOR SHARE;
  IF kind <> 'DEAL' OR project IS NOT NULL THEN
    RAISE EXCEPTION 'A pipeline needs a standalone Deal board' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Pipeline_guard" BEFORE INSERT ON "Pipeline" FOR EACH ROW EXECUTE FUNCTION yuzu_guard_pipeline();
CREATE FUNCTION yuzu_guard_pipeline_board() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Pipeline" WHERE "boardId" = OLD."id")
     AND (NEW."recordType" <> 'DEAL' OR NEW."projectId" IS NOT NULL OR NEW."workspaceId" <> OLD."workspaceId") THEN
    RAISE EXCEPTION 'A pipeline board stays a standalone Deal board in its workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Board_pipeline_guard" BEFORE UPDATE ON "Board" FOR EACH ROW EXECUTE FUNCTION yuzu_guard_pipeline_board();

-- At commit every pipeline has an Open, a Won and a Lost stage, and an Open
-- default stage of its own.
CREATE FUNCTION yuzu_check_pipeline_stages(board TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE defaulted TEXT;
DECLARE wanted TEXT;
BEGIN
  SELECT "defaultStageId" INTO defaulted FROM "Pipeline" WHERE "boardId" = board;
  IF NOT FOUND THEN RETURN; END IF;
  FOREACH wanted IN ARRAY ARRAY['OPEN', 'WON', 'LOST'] LOOP
    IF NOT EXISTS (SELECT 1 FROM "PipelineStage" s WHERE s."boardId" = board AND s."category" = wanted) THEN
      RAISE EXCEPTION 'A pipeline keeps at least one % stage', wanted USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF defaulted IS NULL OR NOT EXISTS (
    SELECT 1 FROM "PipelineStage" s WHERE s."id" = defaulted AND s."boardId" = board AND s."category" = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'A pipeline''s default stage must be one of its Open stages' USING ERRCODE = '23514';
  END IF;
END $$;
CREATE FUNCTION yuzu_pipeline_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM yuzu_check_pipeline_stages(OLD."boardId");
  ELSE
    PERFORM yuzu_check_pipeline_stages(NEW."boardId");
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Pipeline_stages_valid" AFTER INSERT OR UPDATE ON "Pipeline" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION yuzu_pipeline_changed();
CREATE CONSTRAINT TRIGGER "PipelineStage_valid" AFTER INSERT OR UPDATE OR DELETE ON "PipelineStage" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION yuzu_pipeline_changed();

-- A deal profile sits on a top-level record of its own pipeline board.
CREATE FUNCTION yuzu_guard_deal_profile() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE board TEXT;
DECLARE space TEXT;
DECLARE parent TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."recordId" <> OLD."recordId" OR NEW."workspaceId" <> OLD."workspaceId" OR NEW."boardId" <> OLD."boardId") THEN
    RAISE EXCEPTION 'A deal profile keeps its record, board and workspace' USING ERRCODE = '23514';
  END IF;
  SELECT t."boardId", b."workspaceId", t."parentId" INTO board, space, parent
    FROM "Task" t JOIN "Board" b ON b."id" = t."boardId"
    WHERE t."id" = NEW."recordId" FOR SHARE OF t;
  IF FOUND AND (board <> NEW."boardId" OR space <> NEW."workspaceId" OR parent IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM "Pipeline" WHERE "boardId" = board)) THEN
    RAISE EXCEPTION 'A deal profile needs a top-level record on its pipeline board' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "DealProfile_guard" BEFORE INSERT OR UPDATE ON "DealProfile" FOR EACH ROW EXECUTE FUNCTION yuzu_guard_deal_profile();

-- Every Deal on a pipeline has its profile by commit and keeps it.
CREATE FUNCTION yuzu_require_deal_profile() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Task" WHERE "id" = NEW."id")
     AND EXISTS (SELECT 1 FROM "Pipeline" WHERE "boardId" = NEW."boardId")
     AND NOT EXISTS (SELECT 1 FROM "DealProfile" WHERE "recordId" = NEW."id") THEN
    RAISE EXCEPTION 'A pipeline Deal needs its profile' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Task_deal_profile_required" AFTER INSERT ON "Task" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION yuzu_require_deal_profile();
CREATE CONSTRAINT TRIGGER "DealProfile_kept" AFTER DELETE ON "DealProfile" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION yuzu_keep_crm_profile();

-- Purging a customer record leaves its Deals without a customer, not broken.
CREATE FUNCTION yuzu_release_deal_customer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'CompanyProfile' THEN
    UPDATE "DealProfile" SET "customerCompanyId" = NULL WHERE "customerCompanyId" = OLD."recordId";
  ELSE
    UPDATE "DealProfile" SET "customerContactId" = NULL WHERE "customerContactId" = OLD."recordId";
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "CompanyProfile_release_deals" BEFORE DELETE ON "CompanyProfile" FOR EACH ROW EXECUTE FUNCTION yuzu_release_deal_customer();
CREATE TRIGGER "ContactProfile_release_deals" BEFORE DELETE ON "ContactProfile" FOR EACH ROW EXECUTE FUNCTION yuzu_release_deal_customer();
