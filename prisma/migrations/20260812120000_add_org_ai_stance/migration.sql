-- CreateTable: OrgAiStance — the org's published AI stance as VERSIONED ROWS (W3). Each publish
-- appends a row at version N+1 and marks the prior published row "superseded"; at most one draft
-- and one published row per org at a time. stanceJson is serialized AiStance (JSON-in-TEXT, the
-- schema's no-jsonb DSQL-safety contract, exactly like Organization.gatePolicy).
CREATE TABLE "OrgAiStance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "stanceJson" TEXT NOT NULL,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgAiStance_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OrgArtifactAck — a repo's acknowledgement of an org-level artifact version (the
-- repo ⇄ stance-version link the Perimeter prototype surfaced as the biggest schema gap). One row
-- per (org, artifact, repo); re-acknowledging a newer version UPDATES the row (sparse upsert,
-- mirror OrgDecision). `artifact` = "ai-stance" today; named so a later org artifact can reuse it.
CREATE TABLE "OrgArtifactAck" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "artifact" TEXT NOT NULL DEFAULT 'ai-stance',
    "version" INTEGER NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "ackedBy" TEXT,
    "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgArtifactAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgAiStance_orgId_version_key" ON "OrgAiStance"("orgId", "version");

-- CreateIndex
CREATE INDEX "OrgAiStance_orgId_status_idx" ON "OrgAiStance"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrgArtifactAck_orgId_artifact_repoFullName_key" ON "OrgArtifactAck"("orgId", "artifact", "repoFullName");

-- CreateIndex
CREATE INDEX "OrgArtifactAck_orgId_artifact_version_idx" ON "OrgArtifactAck"("orgId", "artifact", "version");
