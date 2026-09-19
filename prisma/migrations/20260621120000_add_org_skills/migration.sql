-- Org Skills Library (Feature 2): a categorized, filterable catalog of reusable org-authored skills
-- with adoption tracking and a download/use counter. Mirrors the Playbook stack; adds an indexed
-- `category` for scalable filtering and a denormalized `downloadCount` for DB-side sort-by-most-used.
-- All additive; no FKs (relationMode="prisma").

-- CreateTable
CREATE TABLE "OrgSkill" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgSkillAdoption" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "adoptedBy" TEXT,
    "adoptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSkillAdoption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgSkillDownload" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastSeen" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSkillDownload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgSkill_orgId_archived_idx" ON "OrgSkill"("orgId", "archived");

-- CreateIndex
CREATE INDEX "OrgSkill_orgId_category_idx" ON "OrgSkill"("orgId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "OrgSkill_orgId_name_key" ON "OrgSkill"("orgId", "name");

-- CreateIndex
CREATE INDEX "OrgSkillAdoption_skillId_idx" ON "OrgSkillAdoption"("skillId");

-- CreateIndex
CREATE INDEX "OrgSkillAdoption_orgId_idx" ON "OrgSkillAdoption"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgSkillAdoption_skillId_repoFullName_key" ON "OrgSkillAdoption"("skillId", "repoFullName");

-- CreateIndex
CREATE UNIQUE INDEX "OrgSkillDownload_skillId_key" ON "OrgSkillDownload"("skillId");
