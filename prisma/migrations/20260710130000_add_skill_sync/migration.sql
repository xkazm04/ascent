-- Skill sync + two-way machine access (Feature 2 extension): org-scoped API tokens for repos/CLI/CI,
-- a content hash on each skill for cheap manifest diffing, and an append-only per-use event table for
-- sliceable "use rate" telemetry. All additive; no FKs (relationMode="prisma").

-- AlterTable: manifest change key (sha256 hex of content); '' until the next create/edit backfills it.
ALTER TABLE "OrgSkill" ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "OrgSkillEvent" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "repo" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSkillEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgApiToken" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "createdBy" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgSkillEvent_skillId_idx" ON "OrgSkillEvent"("skillId");

-- CreateIndex
CREATE INDEX "OrgSkillEvent_orgId_createdAt_idx" ON "OrgSkillEvent"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrgApiToken_tokenHash_key" ON "OrgApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OrgApiToken_orgId_idx" ON "OrgApiToken"("orgId");
