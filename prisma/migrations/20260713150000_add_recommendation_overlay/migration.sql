-- CreateTable: personal-workspace overlay on shared public-corpus recommendations (individual tier).
-- One viewer's private status/due-date/note on a recommendation, keyed by the personal org + the
-- recommendation's stable identity (repoFullName + dimId + title); shared Recommendation rows are
-- never mutated from a personal workspace.
CREATE TABLE "RecommendationOverlay" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "dimId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "targetDate" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationOverlay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationOverlay_orgId_repoFullName_dimId_title_key" ON "RecommendationOverlay"("orgId", "repoFullName", "dimId", "title");

-- CreateIndex
CREATE INDEX "RecommendationOverlay_orgId_repoFullName_idx" ON "RecommendationOverlay"("orgId", "repoFullName");
