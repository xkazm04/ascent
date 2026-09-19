-- The registry's knowledge/ lane, denormalized onto the registry row.
--
-- A Reference Knowledge Bundle is ~1,000 markdown documents; ascent reads only each bundle's
-- GENERATED index (knowledge/<domain>/index.json) and stores that summary here, so the Knowledge
-- tab renders without re-reading the lane — the same reason skillCount/usageInvokes30d are already
-- denormalized.
--
-- JSON rather than a table: the row count is the BUNDLE count (one today, a handful ever), and every
-- field is owned by the bundle's own generator. Normalizing numbers ascent only reads would make it
-- look like a second authority for them.
--
-- ADDITIVE and idempotent, matching 20260818120000_add_org_registry: the column carries a DEFAULT,
-- so no backfill is needed — an existing row reads '[]', which is exactly true of a registry whose
-- knowledge lane has not been indexed yet.

-- AlterTable
ALTER TABLE "OrgRegistry" ADD COLUMN IF NOT EXISTS "bundlesJson" TEXT NOT NULL DEFAULT '[]';
