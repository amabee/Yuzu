-- Keep the existing UUID identity-upgrade path compatible with hierarchy FKs.
-- Direct reparenting stays prohibited; FK cascades may only renumber references.
ALTER TABLE "Task" DROP CONSTRAINT "Task_parent_fk";
ALTER TABLE "Task" ADD CONSTRAINT "Task_parent_fk" FOREIGN KEY ("boardId", "parentId") REFERENCES "Task"("boardId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BoardProposal" DROP CONSTRAINT "BoardProposal_parent_fk";
ALTER TABLE "BoardProposal" ADD CONSTRAINT "BoardProposal_parent_fk" FOREIGN KEY ("boardId", "parentTaskId") REFERENCES "Task"("boardId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE OR REPLACE FUNCTION yuzu_guard_subitem() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE ancestor TEXT;
DECLARE kind TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() = 1 AND (NEW."parentId" IS DISTINCT FROM OLD."parentId" OR NEW."boardId" <> OLD."boardId") THEN
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
CREATE OR REPLACE FUNCTION yuzu_guard_subitem_proposal() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE ancestor TEXT;
DECLARE kind TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() = 1 AND (NEW."parentTaskId" IS DISTINCT FROM OLD."parentTaskId" OR NEW."boardId" <> OLD."boardId") THEN
    RAISE EXCEPTION 'Proposal parentage is immutable' USING ERRCODE='23514';
  END IF;
  -- Referential ID upgrades keep JSON references aligned with their typed FK.
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
    IF NEW."boardId" <> OLD."boardId" AND NEW."changes" ? 'boardId' THEN NEW."changes" = jsonb_set(NEW."changes", '{boardId}', to_jsonb(NEW."boardId")); END IF;
    IF NEW."parentTaskId" IS DISTINCT FROM OLD."parentTaskId" THEN NEW."changes" = jsonb_set(NEW."changes", '{parentId}', to_jsonb(NEW."parentTaskId")); END IF;
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
