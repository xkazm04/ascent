-- Tech-stack grouping (Feature 3b): auto-derived, multi-membership groups of repos by detected stack
-- (frontend / backend:<lang> / mobile / data_ml / infra / library), maintained by syncTechStackGroups.
-- No FKs (relationMode="prisma").

-- CreateTable
CREATE TABLE "TechStackGroup" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechStackGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechStackGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,

    CONSTRAINT "TechStackGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechStackGroup_orgId_idx" ON "TechStackGroup"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TechStackGroup_orgId_key_key" ON "TechStackGroup"("orgId", "key");

-- CreateIndex
CREATE INDEX "TechStackGroupMember_groupId_idx" ON "TechStackGroupMember"("groupId");

-- CreateIndex
CREATE INDEX "TechStackGroupMember_repoId_idx" ON "TechStackGroupMember"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "TechStackGroupMember_groupId_repoId_key" ON "TechStackGroupMember"("groupId", "repoId");
