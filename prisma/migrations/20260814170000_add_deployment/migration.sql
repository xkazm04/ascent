-- Deployments + the merge-commit SHA that makes deployment attribution EXACT (W4).
--
-- Ascent could already say a change was reverted (a git fact) but not whether it BROKE anything.
-- DORA's change-failure rate needs a deployment event, and GitHub's Deployments API reports one for
-- free through the installation token the scan already holds.
--
-- `AiChange.mergeCommitSha` was already on the wire (the W5 revert linkage pages mergeCommit.oid and
-- discarded it). Persisting it turns "which change did this deployment ship?" from a time-window
-- guess into a sha equality — which matters because that join sits underneath the most quotable
-- number this product can produce.
--
-- No backfill: existing AiChange rows carry NULL until their repo is re-scanned, and the derived
-- reads report attribution COVERAGE rather than silently narrowing their denominator.
ALTER TABLE "AiChange" ADD COLUMN "mergeCommitSha" TEXT;

-- CreateIndex
CREATE INDEX "AiChange_orgId_mergeCommitSha_idx" ON "AiChange"("orgId", "mergeCommitSha");

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "ref" TEXT,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "statusAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_repoId_externalId_key" ON "Deployment"("repoId", "externalId");

-- CreateIndex
CREATE INDEX "Deployment_orgId_createdAt_idx" ON "Deployment"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Deployment_orgId_sha_idx" ON "Deployment"("orgId", "sha");
