ALTER TABLE "Task" ADD COLUMN "parentId" TEXT, ADD COLUMN "childrenRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BoardProposal" ADD COLUMN "parentTaskId" TEXT;
CREATE UNIQUE INDEX "Task_boardId_id_key" ON "Task"("boardId", "id");
CREATE INDEX "Task_parentId_position_id_idx" ON "Task"("parentId", "position", "id");
CREATE INDEX "BoardProposal_parentTaskId_status_idx" ON "BoardProposal"("parentTaskId", "status");
ALTER TABLE "Task" ADD CONSTRAINT "Task_parent_fk" FOREIGN KEY ("boardId", "parentId") REFERENCES "Task"("boardId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "BoardProposal" ADD CONSTRAINT "BoardProposal_parent_fk" FOREIGN KEY ("boardId", "parentTaskId") REFERENCES "Task"("boardId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "Task" ADD CONSTRAINT "Task_child_group_check" CHECK ("parentId" IS NULL OR "groupId" IS NULL), ADD CONSTRAINT "Task_parent_self_check" CHECK ("parentId" IS NULL OR "parentId" <> "id"), ADD CONSTRAINT "Task_children_revision_check" CHECK ("childrenRevision" >= 0);
ALTER TABLE "BoardProposal" ADD CONSTRAINT "BoardProposal_parent_payload_check" CHECK (
  "parentTaskId" IS NULL OR ("operation" = 'CREATE' AND "changes"->>'parentId' IS NOT NULL AND "parentTaskId" = "changes"->>'parentId')
);
-- The internal setting is transaction-local and only set by server subitem
-- services after authorization. No route or user-facing feature enables it yet.
CREATE FUNCTION yuzu_guard_subitem() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE ancestor TEXT;
DECLARE kind TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."parentId" IS DISTINCT FROM OLD."parentId" OR NEW."boardId" <> OLD."boardId") THEN
    RAISE EXCEPTION 'Task parentage is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."parentId" IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND coalesce(current_setting('yuzu.subitems_internal', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Subitem creation is not available through ordinary writes' USING ERRCODE='23514';
    END IF;
    SELECT "recordType" INTO kind FROM "Board" WHERE "id"=NEW."boardId" FOR SHARE;
    IF kind <> 'TASK' THEN RAISE EXCEPTION 'Only Task boards support subitems' USING ERRCODE='23514'; END IF;
    SELECT "parentId" INTO ancestor FROM "Task" WHERE "id"=NEW."parentId" AND "boardId"=NEW."boardId" FOR SHARE;
    IF FOUND AND ancestor IS NOT NULL THEN RAISE EXCEPTION 'Only one subitem level is supported' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Task_subitem_guard" BEFORE INSERT OR UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION yuzu_guard_subitem();
CREATE FUNCTION yuzu_guard_subitem_proposal() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE ancestor TEXT;
DECLARE kind TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."parentTaskId" IS DISTINCT FROM OLD."parentTaskId" OR NEW."boardId" <> OLD."boardId") THEN
    RAISE EXCEPTION 'Proposal parentage is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW."parentTaskId" IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND coalesce(current_setting('yuzu.subitems_internal', true), '') <> 'on' THEN
      RAISE EXCEPTION 'Subitem proposals require an authorized service' USING ERRCODE='23514';
    END IF;
    SELECT t."parentId", b."recordType" INTO ancestor, kind FROM "Task" t JOIN "Board" b ON b."id"=t."boardId" WHERE t."id"=NEW."parentTaskId" AND t."boardId"=NEW."boardId" FOR SHARE OF t;
    IF FOUND AND (ancestor IS NOT NULL OR kind <> 'TASK') THEN RAISE EXCEPTION 'A subitem proposal requires a Task root' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "BoardProposal_subitem_guard" BEFORE INSERT OR UPDATE ON "BoardProposal" FOR EACH ROW EXECUTE FUNCTION yuzu_guard_subitem_proposal();
CREATE FUNCTION yuzu_guard_subitem_board_type() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."recordType" <> OLD."recordType" AND (EXISTS (SELECT 1 FROM "Task" WHERE "boardId"=OLD."id" AND "parentId" IS NOT NULL) OR EXISTS (SELECT 1 FROM "BoardProposal" WHERE "boardId"=OLD."id" AND "parentTaskId" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Cannot change a board type with subitem dependencies' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Board_subitem_type_guard" BEFORE UPDATE ON "Board" FOR EACH ROW EXECUTE FUNCTION yuzu_guard_subitem_board_type();
