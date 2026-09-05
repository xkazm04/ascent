-- CreateTable
CREATE TABLE "OrgDecision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "rationale" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "decidedBy" TEXT,
    "memoryId" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgDecision_orgId_module_itemKey_key" ON "OrgDecision"("orgId", "module", "itemKey");

-- CreateIndex
CREATE INDEX "OrgDecision_orgId_status_idx" ON "OrgDecision"("orgId", "status");

-- CreateIndex
CREATE INDEX "OrgDecision_orgId_module_idx" ON "OrgDecision"("orgId", "module");
