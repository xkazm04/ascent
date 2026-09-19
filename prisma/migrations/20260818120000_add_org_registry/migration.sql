-- UC2 "Registry" (docs/REGISTRY-AND-CARE-IMPL.md §2) — the customer-owned registry repo ascent
-- onboards, indexes and tracks, plus the mirror columns that let every existing read surface keep
-- working while the source of truth moves out of ascent's tables and into git.
--
-- Everything here is ADDITIVE: new tables, and new columns that are nullable or carry a DEFAULT. No
-- backfill is needed — an existing OrgSkill/OrgMemory row reads as `origin = 'hosted'` (exactly its
-- behavior today) and an existing Repository row as `role = 'fleet'`. Every statement is idempotent
-- so this is a no-op against a database already bootstrapped from prisma/init.sql (the local PGlite
-- dev path), matching 20260814210000_repair_migration_drift's house style.

-- CreateTable
CREATE TABLE IF NOT EXISTS "OrgRegistry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repositoryId" TEXT,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "canonical" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'git_native',
    "telemetrySink" TEXT NOT NULL DEFAULT 'off',
    "status" TEXT NOT NULL DEFAULT 'unmapped',
    "lastIndexedAt" TIMESTAMP(3),
    "lastIndexSha" TEXT,
    "catalogSha" TEXT,
    "webhookHealthy" BOOLEAN NOT NULL DEFAULT false,
    "policiesJson" TEXT,
    "migrationJson" TEXT,
    "scaffoldPrUrl" TEXT,
    "lastError" TEXT,
    "skillCount" INTEGER NOT NULL DEFAULT 0,
    "practiceCount" INTEGER NOT NULL DEFAULT 0,
    "memoryCount" INTEGER NOT NULL DEFAULT 0,
    "lessonCount" INTEGER NOT NULL DEFAULT 0,
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OrgRegistry_orgId_fullName_key" ON "OrgRegistry"("orgId", "fullName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrgRegistry_orgId_canonical_idx" ON "OrgRegistry"("orgId", "canonical");

-- CreateTable
CREATE TABLE IF NOT EXISTS "OrgPracticeShape" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL DEFAULT '',
    "dimension" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "appliesWhen" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL DEFAULT 'hosted',
    "registryId" TEXT,
    "registryPath" TEXT,
    "registryHash" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgPracticeShape_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OrgPracticeShape_orgId_slug_key" ON "OrgPracticeShape"("orgId", "slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrgPracticeShape_orgId_archived_idx" ON "OrgPracticeShape"("orgId", "archived");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrgPracticeShape_registryId_registryPath_idx" ON "OrgPracticeShape"("registryId", "registryPath");

-- AlterTable
ALTER TABLE IF EXISTS "OrgSkill" ADD COLUMN IF NOT EXISTS     "origin" TEXT NOT NULL DEFAULT 'hosted',
ADD COLUMN IF NOT EXISTS     "registryId" TEXT,
ADD COLUMN IF NOT EXISTS     "registryPath" TEXT,
ADD COLUMN IF NOT EXISTS     "registryHash" TEXT,
ADD COLUMN IF NOT EXISTS     "registryVersion" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrgSkill_registryId_registryPath_idx" ON "OrgSkill"("registryId", "registryPath");

-- AlterTable
ALTER TABLE IF EXISTS "OrgMemory" ADD COLUMN IF NOT EXISTS     "origin" TEXT NOT NULL DEFAULT 'hosted',
ADD COLUMN IF NOT EXISTS     "registryId" TEXT,
ADD COLUMN IF NOT EXISTS     "registryPath" TEXT,
ADD COLUMN IF NOT EXISTS     "registryHash" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrgMemory_registryId_registryPath_idx" ON "OrgMemory"("registryId", "registryPath");

-- AlterTable
ALTER TABLE IF EXISTS "Repository" ADD COLUMN IF NOT EXISTS     "role" TEXT NOT NULL DEFAULT 'fleet';
