-- CreateTable: a SAVED Roadmap Sandbox scenario — the what-if a leader modeled on one repo's report.
-- The overrides used to be React state and the projected delta survived only as a rounded number
-- inside an English event note, so a reload erased the plan and nothing could ever reconcile it.
-- Here the projection is stored as NUMBERS and the baseline it was modeled against is pinned, which
-- is what makes projected-vs-actual answerable after the next scan. Selected roadmap gaps are held as
-- recommendationDecisionKey identities (itemKeysJson), not the fragile dimId+title pair and not
-- scan-bound Recommendation ids. One row per (org, repo, author); saving replaces.
CREATE TABLE "SandboxScenario" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "authorLogin" TEXT NOT NULL DEFAULT '',
    "baselineScore" INTEGER NOT NULL,
    "baselineLevel" TEXT NOT NULL,
    "baselineScanAt" TIMESTAMP(3) NOT NULL,
    "overridesJson" TEXT NOT NULL DEFAULT '{}',
    "itemKeysJson" TEXT NOT NULL DEFAULT '[]',
    "projectedScore" INTEGER NOT NULL,
    "projectedLevel" TEXT NOT NULL,
    "projectedDelta" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SandboxScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SandboxScenario_orgId_repoFullName_authorLogin_key" ON "SandboxScenario"("orgId", "repoFullName", "authorLogin");

-- CreateIndex
CREATE INDEX "SandboxScenario_orgId_repoFullName_idx" ON "SandboxScenario"("orgId", "repoFullName");
