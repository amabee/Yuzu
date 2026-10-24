-- Disposable spike schema only. This is NOT a production migration.
CREATE TABLE "Board" (
  "id" TEXT PRIMARY KEY,
  "recordType" TEXT NOT NULL DEFAULT 'TASK',
  "policyVersion" INTEGER NOT NULL DEFAULT 1,
  "requireCreation" BOOLEAN NOT NULL DEFAULT false,
  "reviewerId" TEXT NOT NULL DEFAULT 'reviewer',
  "archivedAt" TIMESTAMPTZ(3)
);
CREATE TABLE "Task" (
  "id" TEXT PRIMARY KEY,
  "boardId" TEXT NOT NULL REFERENCES "Board"("id") ON DELETE CASCADE,
  "parentId" TEXT,
  "name" TEXT NOT NULL DEFAULT 'Task',
  "groupId" TEXT,
  "createdById" TEXT NOT NULL,
  "assigneeIds" TEXT[] NOT NULL DEFAULT '{}',
  "editorIds" TEXT[] NOT NULL DEFAULT '{}',
  "createKey" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "childrenRevision" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMPTZ(3),
  "deletedAt" TIMESTAMPTZ(3),
  UNIQUE ("boardId", "id"),
  UNIQUE ("createdById", "createKey"),
  FOREIGN KEY ("boardId", "parentId") REFERENCES "Task"("boardId", "id") ON DELETE RESTRICT,
  CHECK ("parentId" IS NULL OR "parentId" <> "id"),
  CHECK ("parentId" IS NULL OR "groupId" IS NULL)
);
CREATE INDEX ON "Task" ("parentId", "id");
CREATE TABLE "BoardProposal" (
  "id" TEXT PRIMARY KEY,
  "boardId" TEXT NOT NULL REFERENCES "Board"("id") ON DELETE CASCADE,
  "parentTaskId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'STALE')),
  "changes" JSONB NOT NULL,
  "appliedTaskId" TEXT,
  UNIQUE ("authorId", "requestKey"),
  FOREIGN KEY ("boardId", "parentTaskId") REFERENCES "Task"("boardId", "id") ON DELETE RESTRICT,
  CHECK ("changes"->>'parentId' IS NOT NULL AND "parentTaskId" = "changes"->>'parentId')
);
CREATE INDEX ON "BoardProposal" ("parentTaskId", "status");
CREATE FUNCTION guard_child() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_depth TEXT;
DECLARE board_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."parentId" IS DISTINCT FROM OLD."parentId" OR NEW."boardId" <> OLD."boardId") THEN
    RAISE EXCEPTION 'Task parentage is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."parentId" IS NOT NULL THEN
    SELECT "recordType" INTO board_type FROM "Board" WHERE "id" = NEW."boardId" FOR SHARE;
    IF board_type <> 'TASK' THEN RAISE EXCEPTION 'Only task boards support children' USING ERRCODE = '23514'; END IF;
    SELECT "parentId" INTO parent_depth FROM "Task" WHERE "id" = NEW."parentId" AND "boardId" = NEW."boardId" FOR SHARE;
    IF FOUND AND parent_depth IS NOT NULL THEN RAISE EXCEPTION 'Only one level is supported' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_child BEFORE INSERT OR UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION guard_child();
CREATE FUNCTION guard_board_type() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."recordType" <> OLD."recordType" AND EXISTS (SELECT 1 FROM "Task" WHERE "boardId" = OLD."id" AND "parentId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot change the type of a board containing children' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_board_type BEFORE UPDATE ON "Board" FOR EACH ROW EXECUTE FUNCTION guard_board_type();

CREATE FUNCTION guard_creation_parent() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_depth TEXT;
DECLARE board_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."parentTaskId" <> OLD."parentTaskId" OR NEW."boardId" <> OLD."boardId") THEN
    RAISE EXCEPTION 'Proposal parentage is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT t."parentId", b."recordType" INTO parent_depth, board_type
    FROM "Task" t JOIN "Board" b ON b."id"=t."boardId"
    WHERE t."id"=NEW."parentTaskId" AND t."boardId"=NEW."boardId" FOR SHARE OF t;
  IF FOUND AND (parent_depth IS NOT NULL OR board_type <> 'TASK') THEN
    RAISE EXCEPTION 'A creation proposal requires a task root' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_creation_parent BEFORE INSERT OR UPDATE ON "BoardProposal" FOR EACH ROW EXECUTE FUNCTION guard_creation_parent();
