-- AlterTable: tenant flavor — "org" (a GitHub organization fleet) or "personal" (an individual's
-- workspace, slug = their GitHub login). Existing rows are all real orgs (or the shared "public"
-- funnel), so the default backfills them correctly.
ALTER TABLE "Organization" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'org';
