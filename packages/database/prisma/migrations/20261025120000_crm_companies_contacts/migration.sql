-- CreateTable
CREATE TABLE "CompanyProfile" (
    "recordId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "legalName" TEXT,
    "website" TEXT,
    "domain" TEXT,
    "email" TEXT,
    "emailKey" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("recordId")
);

-- CreateTable
CREATE TABLE "ContactProfile" (
    "recordId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT,
    "emailKey" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ContactProfile_pkey" PRIMARY KEY ("recordId")
);

-- CreateIndex
CREATE INDEX "CompanyProfile_workspaceId_domain_idx" ON "CompanyProfile"("workspaceId", "domain");

-- CreateIndex
CREATE INDEX "CompanyProfile_workspaceId_emailKey_idx" ON "CompanyProfile"("workspaceId", "emailKey");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_recordId_workspaceId_key" ON "CompanyProfile"("recordId", "workspaceId");

-- CreateIndex
CREATE INDEX "ContactProfile_workspaceId_emailKey_idx" ON "ContactProfile"("workspaceId", "emailKey");

-- CreateIndex
CREATE UNIQUE INDEX "ContactProfile_recordId_workspaceId_key" ON "ContactProfile"("recordId", "workspaceId");

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactProfile" ADD CONSTRAINT "ContactProfile_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactProfile" ADD CONSTRAINT "ContactProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One Companies and one Contacts collection per workspace, always standalone
-- (never inside a project). See docs/specs/companies-contacts.md.
CREATE UNIQUE INDEX "Board_crm_collection_key" ON "Board"("workspaceId", "recordType") WHERE "recordType" IN ('COMPANY', 'CONTACT');
ALTER TABLE "Board" ADD CONSTRAINT "Board_crm_standalone_check" CHECK ("recordType" NOT IN ('COMPANY', 'CONTACT') OR "projectId" IS NULL);

-- A collection keeps its type and workspace, and no board becomes one later.
CREATE FUNCTION yuzu_guard_crm_board() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."recordType" <> OLD."recordType" AND (OLD."recordType" IN ('COMPANY', 'CONTACT') OR NEW."recordType" IN ('COMPANY', 'CONTACT')))
     OR (OLD."recordType" IN ('COMPANY', 'CONTACT') AND NEW."workspaceId" <> OLD."workspaceId") THEN
    RAISE EXCEPTION 'Company and Contact collections keep their type and workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Board_crm_guard" BEFORE UPDATE ON "Board" FOR EACH ROW EXECUTE FUNCTION yuzu_guard_crm_board();

-- A profile belongs to a top-level record on its own workspace's collection of
-- the matching type, so a record can never have the wrong or a second profile.
CREATE FUNCTION yuzu_guard_crm_profile() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE kind TEXT;
DECLARE space TEXT;
DECLARE parent TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."recordId" <> OLD."recordId" OR NEW."workspaceId" <> OLD."workspaceId") THEN
    RAISE EXCEPTION 'A profile keeps its record and workspace' USING ERRCODE = '23514';
  END IF;
  SELECT b."recordType", b."workspaceId", t."parentId" INTO kind, space, parent
    FROM "Task" t JOIN "Board" b ON b."id" = t."boardId"
    WHERE t."id" = NEW."recordId" FOR SHARE OF t;
  -- A missing record is reported by the foreign key.
  IF FOUND AND (kind <> TG_ARGV[0] OR space <> NEW."workspaceId" OR parent IS NOT NULL) THEN
    RAISE EXCEPTION 'A % profile needs a top-level record on its workspace''s % collection', TG_ARGV[0], TG_ARGV[0] USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CompanyProfile_guard" BEFORE INSERT OR UPDATE ON "CompanyProfile" FOR EACH ROW EXECUTE FUNCTION yuzu_guard_crm_profile('COMPANY');
CREATE TRIGGER "ContactProfile_guard" BEFORE INSERT OR UPDATE ON "ContactProfile" FOR EACH ROW EXECUTE FUNCTION yuzu_guard_crm_profile('CONTACT');

-- Every Company or Contact record has its profile by the end of the
-- transaction that creates it, and keeps it until the record is purged.
CREATE FUNCTION yuzu_require_crm_profile() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE kind TEXT;
BEGIN
  SELECT b."recordType" INTO kind FROM "Task" t JOIN "Board" b ON b."id" = t."boardId" WHERE t."id" = NEW."id";
  IF (kind = 'COMPANY' AND NOT EXISTS (SELECT 1 FROM "CompanyProfile" WHERE "recordId" = NEW."id"))
     OR (kind = 'CONTACT' AND NOT EXISTS (SELECT 1 FROM "ContactProfile" WHERE "recordId" = NEW."id")) THEN
    RAISE EXCEPTION 'A % record needs its profile', kind USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Task_crm_profile_required" AFTER INSERT ON "Task" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION yuzu_require_crm_profile();
CREATE FUNCTION yuzu_keep_crm_profile() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Task" WHERE "id" = OLD."recordId") THEN
    RAISE EXCEPTION 'A Company or Contact record keeps its profile' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "CompanyProfile_kept" AFTER DELETE ON "CompanyProfile" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION yuzu_keep_crm_profile();
CREATE CONSTRAINT TRIGGER "ContactProfile_kept" AFTER DELETE ON "ContactProfile" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION yuzu_keep_crm_profile();
