-- AlterTable
ALTER TABLE "ContactProfile" ADD COLUMN     "primaryRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ContactCompany" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CURRENT',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ContactCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliationRequest" (
    "actorId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliationRequest_pkey" PRIMARY KEY ("actorId","requestKey")
);

-- CreateIndex
CREATE INDEX "ContactCompany_companyId_status_id_idx" ON "ContactCompany"("companyId", "status", "id");

-- CreateIndex
CREATE INDEX "ContactCompany_contactId_status_id_idx" ON "ContactCompany"("contactId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ContactCompany_contactId_companyId_key" ON "ContactCompany"("contactId", "companyId");

-- AddForeignKey
ALTER TABLE "ContactCompany" ADD CONSTRAINT "ContactCompany_contactId_workspaceId_fkey" FOREIGN KEY ("contactId", "workspaceId") REFERENCES "ContactProfile"("recordId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactCompany" ADD CONSTRAINT "ContactCompany_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "CompanyProfile"("recordId", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Link rules the database keeps even for direct writes.
ALTER TABLE "ContactCompany"
  ADD CONSTRAINT "ContactCompany_status_check" CHECK ("status" IN ('CURRENT', 'FORMER')),
  ADD CONSTRAINT "ContactCompany_primary_current_check" CHECK (NOT "isPrimary" OR "status" = 'CURRENT'),
  ADD CONSTRAINT "ContactCompany_role_check" CHECK ("role" IS NULL OR char_length("role") BETWEEN 1 AND 120),
  ADD CONSTRAINT "ContactCompany_revision_check" CHECK ("revision" > 0);
ALTER TABLE "ContactProfile" ADD CONSTRAINT "ContactProfile_primary_revision_check" CHECK ("primaryRevision" >= 0);
-- At most one primary company per contact.
CREATE UNIQUE INDEX "ContactCompany_one_primary_key" ON "ContactCompany"("contactId") WHERE "isPrimary";

-- A link keeps its two ends and workspace; change the link by removing it.
CREATE FUNCTION yuzu_guard_contact_company() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."contactId" <> OLD."contactId" OR NEW."companyId" <> OLD."companyId" OR NEW."workspaceId" <> OLD."workspaceId" THEN
    RAISE EXCEPTION 'A company link keeps its contact, company and workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ContactCompany_guard" BEFORE UPDATE ON "ContactCompany" FOR EACH ROW EXECUTE FUNCTION yuzu_guard_contact_company();

-- Removing a primary link (including by purging either record) changes the
-- contact's primary selection, so its primary revision moves on too.
CREATE FUNCTION yuzu_primary_link_removed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isPrimary" THEN
    UPDATE "ContactProfile" SET "primaryRevision" = "primaryRevision" + 1 WHERE "recordId" = OLD."contactId";
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "ContactCompany_primary_removed" AFTER DELETE ON "ContactCompany" FOR EACH ROW EXECUTE FUNCTION yuzu_primary_link_removed();
