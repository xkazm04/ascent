-- CreateTable
CREATE TABLE "AiUsageRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "seats" INTEGER NOT NULL DEFAULT 0,
    "fidelity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageRecord_orgId_source_scope_scopeKey_periodStart_key" ON "AiUsageRecord"("orgId", "source", "scope", "scopeKey", "periodStart");

-- CreateIndex
CREATE INDEX "AiUsageRecord_orgId_source_idx" ON "AiUsageRecord"("orgId", "source");
