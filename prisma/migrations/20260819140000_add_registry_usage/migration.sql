-- The registry's `usage/` lane, denormalized onto the registry row.
--
-- Which skills the fleet actually reaches for is contributed BY the installations that run them
-- (one `usage/<contributor>.json` per installation) and aggregated at index time. Ascent reads that
-- lane; it does not count invocations itself. Two writers for one number is the failure the
-- per-contributor files exist to prevent, and this column is a cache of the read, not a second
-- source.
--
-- Denormalized for the same reason skillCount/practiceCount already are: the Registry tab's header
-- renders without re-reading the lane.
--
-- ADDITIVE and idempotent, matching the house style of 20260818120000_add_org_registry: both columns
-- carry a DEFAULT, so no backfill is needed — an existing row reads 0, which is exactly true of a
-- registry nobody has contributed usage to yet.

-- AlterTable
ALTER TABLE "OrgRegistry" ADD COLUMN IF NOT EXISTS "usageInvokes30d" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrgRegistry" ADD COLUMN IF NOT EXISTS "usageContributors" INTEGER NOT NULL DEFAULT 0;
