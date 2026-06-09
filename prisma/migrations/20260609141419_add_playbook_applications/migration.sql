-- CreateTable
CREATE TABLE "PlaybookApplication" (
    "id" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "appliedBy" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybookApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaybookApplication_playbookId_idx" ON "PlaybookApplication"("playbookId");

-- CreateIndex
CREATE INDEX "PlaybookApplication_orgId_idx" ON "PlaybookApplication"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybookApplication_playbookId_repoFullName_key" ON "PlaybookApplication"("playbookId", "repoFullName");
