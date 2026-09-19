-- CREATE the AiChange evidence-row table.
--
-- BACKFILL OF A MISSING MIGRATION, not a new feature. `AiChange` has been in schema.prisma and
-- mirrored in init.sql since the AI-change population shipped, but no migration ever created it —
-- so `prisma migrate deploy` against an empty database FAILED at
-- 20260812150000_add_ai_change_revert_linkage ("relation AiChange does not exist"). The psql
-- bootstrap path (init.sql) worked, which is why it went unnoticed; the migration path did not.
-- Found 2026-08-14 while standing up a clean database for the e2e run.
--
-- Timestamped 20260812140000 so it sorts BEFORE the revert-linkage ALTER that assumes it. Columns
-- here are the table as it was at that point: `revertedByPr`/`revertedAt` are added by the next
-- migration and `mergeCommitSha` by 20260814170000_add_deployment, so this file must NOT carry them
-- or those ALTERs would fail on a duplicate column.
--
-- IF-NOT-EXISTS on the table and indexes: any database bootstrapped from init.sql already has them,
-- and this must be a no-op there rather than an error that blocks every later migration.
CREATE TABLE IF NOT EXISTS "AiChange" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "authorLogin" TEXT,
    "authorIsBot" BOOLEAN NOT NULL DEFAULT false,
    "aiSignal" TEXT NOT NULL,
    "aiTools" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL,
    "mergedAt" TIMESTAMP(3),
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approverLogin" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AiChange_repoId_prNumber_key" ON "AiChange"("repoId", "prNumber");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiChange_orgId_createdAt_idx" ON "AiChange"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiChange_orgId_approved_idx" ON "AiChange"("orgId", "approved");
