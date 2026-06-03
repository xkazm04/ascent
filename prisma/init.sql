-- Ascent persistence bootstrap for local Postgres (docker-compose).
--
-- Source of truth is prisma/schema.prisma; this file mirrors it for a plain `psql -f`
-- bootstrap. Regenerate after schema changes with:
--   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- On Aurora DSQL, use `prisma migrate` (or CREATE INDEX ASYNC) instead — see docs/ARCHITECTURE.md.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    -- Per-org data-retention overrides (enterprise); null = inherit env default, 0 = unlimited.
    "retentionMaxScans" INTEGER,
    "retentionAuditDays" INTEGER,
    "githubInstallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "primaryLanguage" TEXT,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "headSha" TEXT,
    "headEtag" TEXT,
    "watched" BOOLEAN NOT NULL DEFAULT false,
    "scanSchedule" TEXT NOT NULL DEFAULT 'off',
    "lastScanAt" TIMESTAMP(3),
    "nextScanAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoContributor" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "commits" INTEGER NOT NULL DEFAULT 0,
    "aiCommits" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoContributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Team attribution parsed from a repo's CODEOWNERS at scan time; backs getOrgTeamRollup.
CREATE TABLE "RepoTeam" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownedPaths" INTEGER NOT NULL DEFAULT 0,
    "isDefaultOwner" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'codeowners',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- A user-defined slice of the fleet (a named tag grouping repos); backs the org segment filter.
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b9eff',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Membership of a repo in a segment (the tag join, many-to-many).
CREATE TABLE "RepoSegment" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "headSha" TEXT,
    "overallScore" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "levelName" TEXT NOT NULL,
    "archetype" TEXT NOT NULL DEFAULT 'org',
    "adoptionScore" INTEGER NOT NULL DEFAULT 0,
    "rigorScore" INTEGER NOT NULL DEFAULT 0,
    "posture" TEXT NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engineProvider" TEXT NOT NULL,
    "engineModel" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "strengths" TEXT NOT NULL DEFAULT '[]',
    "risks" TEXT NOT NULL DEFAULT '[]',
    "prStats" TEXT,
    "governance" TEXT,
    "commitActivity" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanDimension" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "dimId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "score" INTEGER NOT NULL,
    "signalScore" INTEGER NOT NULL,
    "llmScore" INTEGER NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL DEFAULT '[]',
    "strengths" TEXT NOT NULL DEFAULT '[]',
    "gaps" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "ScanDimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dimId" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "explore" TEXT NOT NULL DEFAULT '[]',
    "levelUnlock" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    -- Ownership + planning layer (backs the org-wide backlog view); both carry forward across
    -- re-scans (matched by dimId+title). null = unassigned / no deadline.
    "assigneeLogin" TEXT,
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Append-only activity timeline for a recommendation (status / assignee / due-date changes), with
-- the actor, the from→to values, and an optional note — what makes the backlog trustworthy.
CREATE TABLE "RecommendationEvent" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "actor" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'status',
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "stripeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Per-login session version backing server-side session revocation (see src/lib/auth.ts);
-- bumping the version invalidates every outstanding cookie for that login immediately.
CREATE TABLE "SessionRevocation" (
    "login" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRevocation_pkey" PRIMARY KEY ("login")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_orgId_idx" ON "Membership"("orgId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership"("orgId", "userId");

-- CreateIndex
CREATE INDEX "Repository_orgId_idx" ON "Repository"("orgId");

-- CreateIndex
CREATE INDEX "Repository_fullName_idx" ON "Repository"("fullName");

-- CreateIndex
CREATE INDEX "Repository_watched_idx" ON "Repository"("watched");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_orgId_fullName_key" ON "Repository"("orgId", "fullName");

-- CreateIndex
CREATE INDEX "RepoContributor_repoId_idx" ON "RepoContributor"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "RepoContributor_repoId_login_key" ON "RepoContributor"("repoId", "login");

-- CreateIndex
CREATE INDEX "RepoTeam_repoId_idx" ON "RepoTeam"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "RepoTeam_repoId_slug_key" ON "RepoTeam"("repoId", "slug");

-- CreateIndex
CREATE INDEX "Segment_orgId_idx" ON "Segment"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_orgId_name_key" ON "Segment"("orgId", "name");

-- CreateIndex
CREATE INDEX "RepoSegment_segmentId_idx" ON "RepoSegment"("segmentId");

-- CreateIndex
CREATE INDEX "RepoSegment_repoId_idx" ON "RepoSegment"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "RepoSegment_segmentId_repoId_key" ON "RepoSegment"("segmentId", "repoId");

-- CreateIndex
CREATE INDEX "Scan_repoId_idx" ON "Scan"("repoId");

-- CreateIndex
CREATE INDEX "Scan_repoId_scannedAt_idx" ON "Scan"("repoId", "scannedAt");

-- CreateIndex
-- Powers scan deduplication by commit (findScanByCommit: WHERE repoId AND headSha).
CREATE INDEX "Scan_repoId_headSha_idx" ON "Scan"("repoId", "headSha");

-- CreateIndex
CREATE INDEX "ScanDimension_scanId_idx" ON "ScanDimension"("scanId");

-- CreateIndex
CREATE INDEX "Recommendation_scanId_idx" ON "Recommendation"("scanId");

-- CreateIndex
CREATE INDEX "Recommendation_status_idx" ON "Recommendation"("status");

-- CreateIndex
-- Powers the by-owner grouping of the org-wide backlog (getOrgBacklog).
CREATE INDEX "Recommendation_assigneeLogin_idx" ON "Recommendation"("assigneeLogin");

-- CreateIndex
CREATE INDEX "RecommendationEvent_recommendationId_idx" ON "RecommendationEvent"("recommendationId");

-- CreateIndex
CREATE INDEX "RecommendationEvent_createdAt_idx" ON "RecommendationEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_idx" ON "AuditLog"("orgId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
-- Serves the org-scoped audit viewer's keyset query (WHERE orgId ORDER BY at DESC, id DESC).
CREATE INDEX "AuditLog_orgId_at_idx" ON "AuditLog"("orgId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_orgId_key" ON "Subscription"("orgId");

-- Seed the shared "public" organization once. Every anonymous scan persists under this org, so
-- seeding it here (idempotently) lets the app resolve it with a plain read instead of upserting the
-- same hot row on every scan — which on Aurora DSQL (optimistic concurrency, no row locks) makes
-- concurrent scans collide on a retryable serialization conflict. See src/lib/db/scans.ts
-- (ensureOrgId) and docs/ARCHITECTURE.md §3. The id is a fixed sentinel UUID (the column is TEXT;
-- under relationMode="prisma" there are no DB-level FKs, so any stable value is fine).
INSERT INTO "Organization" ("id", "slug", "name", "plan")
VALUES ('00000000-0000-4000-8000-000000000001', 'public', 'Public Scans', 'free')
ON CONFLICT ("slug") DO NOTHING;
