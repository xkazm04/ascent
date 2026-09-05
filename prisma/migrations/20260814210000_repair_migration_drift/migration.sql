-- REPAIR: bring the migration history back in line with schema.prisma.
--
-- `prisma migrate deploy` from an empty database produced a schema the application could not run
-- against: `repository.upsert` failed with "The column (not available) does not exist in the current
-- database". Two tables (AlertEvent, OrgMemory) and six columns had reached schema.prisma and
-- init.sql but never a migration.
--
-- WHY IT WENT UNNOTICED. Local development bootstraps from `prisma/init.sql` (or `db push`), and a
-- test -- src/lib/db/init-sql.test.ts -- pins init.sql against schema.prisma model-for-model. So the
-- path everyone uses daily was verified, while the path a real deployment takes was not. The mirror
-- had a guard; the migrations did not. Found 2026-08-14 standing up a clean database for the e2e run,
-- alongside a missing CREATE TABLE for AiChange (20260812140000_add_ai_change).
--
-- Every statement is IDEMPOTENT so this is a no-op on any database already bootstrapped from
-- init.sql, and a genuine repair on one built from the migration history.
--
-- FOLLOW-UP worth doing: init-sql.test.ts proves init.sql <-> schema.prisma. Nothing proves
-- migrations <-> schema.prisma. A `prisma migrate diff` check in CI would have caught this the day
-- it was introduced.

-- AlterTable
ALTER TABLE IF EXISTS "Membership" ADD COLUMN IF NOT EXISTS     "alertsSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE IF EXISTS "Repository" ADD COLUMN IF NOT EXISTS     "missingSince" TIMESTAMP(3);

-- AlterTable
ALTER TABLE IF EXISTS "Scan" ADD COLUMN IF NOT EXISTS     "aiUsageJson" TEXT,
ADD COLUMN IF NOT EXISTS     "engineByom" BOOLEAN,
ADD COLUMN IF NOT EXISTS     "rubricVersion" TEXT,
ADD COLUMN IF NOT EXISTS     "warningsJson" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AlertEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "repoFullName" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "sinkKind" TEXT,
    "suppressedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OrgMemory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "namespace" TEXT,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'semantic',
    "visibility" TEXT NOT NULL DEFAULT 'shared',
    "source" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "supersededBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AlertEvent_orgId_createdAt_idx" ON "AlertEvent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrgMemory_orgId_archived_idx" ON "OrgMemory"("orgId", "archived");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrgMemory_orgId_namespace_idx" ON "OrgMemory"("orgId", "namespace");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrgMemory_orgId_kind_idx" ON "OrgMemory"("orgId", "kind");

