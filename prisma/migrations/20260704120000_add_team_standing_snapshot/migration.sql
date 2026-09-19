-- CreateTable
CREATE TABLE "TeamStandingSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teamCount" INTEGER NOT NULL,
    "fleetAvgOverall" INTEGER NOT NULL,
    "spread" INTEGER NOT NULL,
    "leaderSlug" TEXT NOT NULL,
    "leaderScore" INTEGER NOT NULL,
    "laggardSlug" TEXT NOT NULL,
    "laggardScore" INTEGER NOT NULL,
    "standingsJson" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'scan',

    CONSTRAINT "TeamStandingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamStandingSnapshot_orgId_generatedAt_idx" ON "TeamStandingSnapshot"("orgId", "generatedAt");
