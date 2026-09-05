-- CreateTable
CREATE TABLE "ImprovementPr" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "dimId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "prNumber" INTEGER NOT NULL,
    "prUrl" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "baselineScanId" TEXT,
    "verifiedScanId" TEXT,
    "impactDim" INTEGER,
    "impactOverall" INTEGER,
    "openedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementPr_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImprovementPr_orgId_state_idx" ON "ImprovementPr"("orgId", "state");

-- CreateIndex
CREATE INDEX "ImprovementPr_orgId_createdAt_idx" ON "ImprovementPr"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImprovementPr_orgId_repoFullName_practiceId_key" ON "ImprovementPr"("orgId", "repoFullName", "practiceId");
