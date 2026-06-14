-- Ascent persistence bootstrap for local Postgres (docker-compose).
--
-- Source of truth is prisma/schema.prisma; this file mirrors it for a plain `psql -f`
-- bootstrap. Regenerate after schema changes with:
--   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- then re-apply this header and the "public" org seed at the bottom of the file.
-- Parity is enforced by src/lib/db/init-sql.test.ts (every schema.prisma model must have its
-- CREATE TABLE here) — the 2026-06 drift left six tables and two columns behind and broke the
-- documented psql bootstrap. On Aurora DSQL, use `prisma migrate` (or CREATE INDEX ASYNC)
-- instead — see docs/ARCHITECTURE.md.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "scanCredits" INTEGER NOT NULL DEFAULT 0,
    "retentionMaxScans" INTEGER,
    "retentionAuditDays" INTEGER,
    "alertWebhookUrl" TEXT,
    "alertOverallDrop" INTEGER,
    "alertDimensionDrop" INTEGER,
    "gatePolicy" JSONB,
    "githubInstallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'scan',
    "repoFullName" TEXT,
    "scanId" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "githubLogin" TEXT,
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
    "lastScanStatus" TEXT,
    "lastScanError" TEXT,
    "lastScanAttemptAt" TIMESTAMP(3),
    "aiConformance" INTEGER,
    "aiConformanceFails" INTEGER,
    "aiConformanceWarns" INTEGER,
    "aiConformanceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b9eff',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoSegment" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoSegment_pkey" PRIMARY KEY ("id")
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
    "discrepancies" TEXT NOT NULL DEFAULT '[]',
    "prStats" TEXT,
    "governance" TEXT,
    "commitActivity" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "llmLatencyMs" INTEGER,
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
    "assigneeLogin" TEXT,
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "metric" TEXT NOT NULL DEFAULT 'overall',
    "target" INTEGER NOT NULL DEFAULT 50,
    "targetDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Initiative" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dimId" TEXT NOT NULL,
    "practiceId" TEXT,
    "targetScore" INTEGER NOT NULL DEFAULT 70,
    "repos" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigneeLogin" TEXT,
    "targetDate" TIMESTAMP(3),
    "goalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Initiative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playbook" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dimId" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "steps" TEXT NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "SessionRevocation" (
    "login" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRevocation_pkey" PRIMARY KEY ("login")
);

-- CreateTable
CREATE TABLE "PublicScanQuota" (
    "ipHash" TEXT NOT NULL,
    "hits" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicScanQuota_pkey" PRIMARY KEY ("ipHash")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "CreditLedger_orgId_idx" ON "CreditLedger"("orgId");

-- CreateIndex
CREATE INDEX "CreditLedger_orgId_createdAt_idx" ON "CreditLedger"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubLogin_key" ON "User"("githubLogin");

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
CREATE INDEX "RepoContributor_repoId_idx" ON "RepoContributor"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "RepoContributor_repoId_login_key" ON "RepoContributor"("repoId", "login");

-- CreateIndex
CREATE INDEX "RepoTeam_repoId_idx" ON "RepoTeam"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "RepoTeam_repoId_slug_key" ON "RepoTeam"("repoId", "slug");

-- CreateIndex
CREATE INDEX "Scan_repoId_idx" ON "Scan"("repoId");

-- CreateIndex
CREATE INDEX "Scan_repoId_scannedAt_idx" ON "Scan"("repoId", "scannedAt");

-- CreateIndex
CREATE INDEX "Scan_repoId_headSha_idx" ON "Scan"("repoId", "headSha");

-- CreateIndex
CREATE INDEX "ScanDimension_scanId_idx" ON "ScanDimension"("scanId");

-- CreateIndex
CREATE INDEX "Recommendation_scanId_idx" ON "Recommendation"("scanId");

-- CreateIndex
CREATE INDEX "Recommendation_status_idx" ON "Recommendation"("status");

-- CreateIndex
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
CREATE INDEX "AuditLog_orgId_at_idx" ON "AuditLog"("orgId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_orgId_key" ON "Subscription"("orgId");

-- CreateIndex
CREATE INDEX "Goal_orgId_idx" ON "Goal"("orgId");

-- CreateIndex
CREATE INDEX "Initiative_orgId_idx" ON "Initiative"("orgId");

-- CreateIndex
CREATE INDEX "Initiative_status_idx" ON "Initiative"("status");

-- CreateIndex
CREATE INDEX "Playbook_orgId_idx" ON "Playbook"("orgId");

-- CreateIndex
CREATE INDEX "PlaybookApplication_playbookId_idx" ON "PlaybookApplication"("playbookId");

-- CreateIndex
CREATE INDEX "PlaybookApplication_orgId_idx" ON "PlaybookApplication"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybookApplication_playbookId_repoFullName_key" ON "PlaybookApplication"("playbookId", "repoFullName");

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT,
    "githubLogin" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE INDEX "Invite_orgId_idx" ON "Invite"("orgId");

-- CreateIndex
CREATE INDEX "Invite_status_idx" ON "Invite"("status");

-- CreateTable
CREATE TABLE "BadgeImpression" (
    "id" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "refererHost" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeImpression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BadgeImpression_repoFullName_refererHost_key" ON "BadgeImpression"("repoFullName", "refererHost");

-- CreateIndex
CREATE INDEX "BadgeImpression_repoFullName_idx" ON "BadgeImpression"("repoFullName");


-- Seed the shared "public" organization once. Every anonymous scan persists under this org, so
-- seeding it here (idempotently) lets the app resolve it with a plain read instead of upserting the
-- same hot row on every scan — which on Aurora DSQL (optimistic concurrency, no row locks) makes
-- concurrent scans collide on a retryable serialization conflict. See src/lib/db/scans.ts
-- (ensureOrgId) and docs/ARCHITECTURE.md §3. The id is a fixed sentinel UUID (the column is TEXT;
-- under relationMode="prisma" there are no DB-level FKs, so any stable value is fine).
INSERT INTO "Organization" ("id", "slug", "name", "plan")
VALUES ('00000000-0000-4000-8000-000000000001', 'public', 'Public Scans', 'free')
ON CONFLICT ("slug") DO NOTHING;
