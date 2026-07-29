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
    "kind" TEXT NOT NULL DEFAULT 'org',
    "scanCredits" INTEGER NOT NULL DEFAULT 0,
    "retentionMaxScans" INTEGER,
    "retentionAuditDays" INTEGER,
    "alertWebhookUrl" TEXT,
    "alertOverallDrop" INTEGER,
    "alertDimensionDrop" INTEGER,
    "gatePolicy" TEXT,
    "brandName" TEXT,
    "brandColor" TEXT,
    "logoUrl" TEXT,
    "timezone" TEXT,
    "autoRechargeJson" TEXT,
    "ingestTokenEpoch" INTEGER NOT NULL DEFAULT 0,
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
    "externalId" TEXT,
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
    "alertsSeenAt" TIMESTAMP(3),

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
-- Idempotent add-column (same rule as Scan's below): pglite-boot rewrites CREATE TABLE -> IF NOT
-- EXISTS, so an EXISTING local .pglite DB needs the new column applied explicitly.
ALTER TABLE "Membership" ADD COLUMN IF NOT EXISTS "alertsSeenAt" TIMESTAMP(3);

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
    "techStackJson" TEXT,
    "passportJson" TEXT,
    "passportOverridesJson" TEXT,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "headSha" TEXT,
    "headEtag" TEXT,
    "watched" BOOLEAN NOT NULL DEFAULT false,
    "scanSchedule" TEXT NOT NULL DEFAULT 'off',
    "lastScanAt" TIMESTAMP(3),
    "nextScanAt" TIMESTAMP(3),
    "scanSlotAt" TIMESTAMP(3),
    "lastScanStatus" TEXT,
    "lastScanError" TEXT,
    "lastScanAttemptAt" TIMESTAMP(3),
    "aiConformance" INTEGER,
    "aiConformanceFails" INTEGER,
    "aiConformanceWarns" INTEGER,
    "aiConformanceAt" TIMESTAMP(3),
    "missingSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);
-- Idempotent add-column (same rule as Scan's below): pglite-boot rewrites CREATE TABLE -> IF NOT
-- EXISTS, so an EXISTING local .pglite DB needs the new column applied explicitly.
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "missingSince" TIMESTAMP(3);

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
CREATE TABLE "AiChange" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "authorLogin" TEXT,
    "authorIsBot" BOOLEAN NOT NULL DEFAULT false,
    "aiSignal" TEXT NOT NULL,
    "aiTools" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL,
    "mergedAt" TIMESTAMP(3),
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approverLogin" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "headSha" TEXT,
    "dedupKey" TEXT,
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
    "techStackJson" TEXT,
    "passportJson" TEXT,
    "warningsJson" TEXT,
    "aiUsageJson" TEXT,
    "rubricVersion" TEXT,
    "engineByom" BOOLEAN,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "llmLatencyMs" INTEGER,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);
-- Idempotent add-column so an EXISTING local .pglite DB picks up new columns without a wipe:
-- pglite-boot rewrites CREATE TABLE -> IF NOT EXISTS (which skips an existing table), so a new column
-- must be applied explicitly. Safe + idempotent on fresh boots (the column already exists) and psql.
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "warningsJson" TEXT;
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "aiUsageJson" TEXT;
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "rubricVersion" TEXT;
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "engineByom" BOOLEAN;

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
    "achievedAt" TIMESTAMP(3),
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
    "playbookId" TEXT,
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
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybookApplication" (
    "id" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "appliedBy" TEXT,
    "appliedVersion" INTEGER,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybookApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImprovementPr" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "dimId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "prNumber" INTEGER NOT NULL,
    "prUrl" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "baselineScanId" TEXT,
    "verifiedScanId" TEXT,
    "impactDim" INTEGER,
    "impactOverall" INTEGER,
    "openedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementPr_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "CreditLedger_externalId_key" ON "CreditLedger"("externalId");

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
CREATE INDEX "AiChange_orgId_createdAt_idx" ON "AiChange"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AiChange_orgId_approved_idx" ON "AiChange"("orgId", "approved");

-- CreateIndex
CREATE UNIQUE INDEX "AiChange_repoId_prNumber_key" ON "AiChange"("repoId", "prNumber");

-- CreateIndex
CREATE INDEX "Scan_repoId_idx" ON "Scan"("repoId");

-- CreateIndex
CREATE INDEX "Scan_repoId_scannedAt_idx" ON "Scan"("repoId", "scannedAt");

-- CreateIndex (UNIQUE: cross-instance same-commit dedup backstop; NULL headSha stays unconstrained)
CREATE UNIQUE INDEX "Scan_repoId_headSha_key" ON "Scan"("repoId", "headSha");

-- CreateIndex (UNIQUE: the SHA-LESS half of the same backstop; NULL dedupKey stays unconstrained)
CREATE UNIQUE INDEX "Scan_repoId_dedupKey_key" ON "Scan"("repoId", "dedupKey");

-- CreateIndex (org-rollup window scan; on DSQL create this one with CREATE INDEX ASYNC)
CREATE INDEX "Scan_scannedAt_idx" ON "Scan"("scannedAt");

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

-- CreateIndex
CREATE INDEX "ImprovementPr_orgId_state_idx" ON "ImprovementPr"("orgId", "state");

-- CreateIndex
CREATE INDEX "ImprovementPr_orgId_createdAt_idx" ON "ImprovementPr"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImprovementPr_orgId_repoFullName_practiceId_key" ON "ImprovementPr"("orgId", "repoFullName", "practiceId");

-- CreateIndex
CREATE INDEX "TeamStandingSnapshot_orgId_generatedAt_idx" ON "TeamStandingSnapshot"("orgId", "generatedAt");

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

-- CreateTable
CREATE TABLE "QuotaEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuotaEvent_kind_scope_key" ON "QuotaEvent"("kind", "scope");

-- CreateTable
CREATE TABLE "SkillGeneration" (
    "id" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "headSha" TEXT,
    "trackIds" TEXT NOT NULL DEFAULT '[]',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillGeneration_repoFullName_idx" ON "SkillGeneration"("repoFullName");


-- CreateTable: Org Skills Library (Feature 2) — categorized, filterable catalog of reusable skills.
CREATE TABLE "OrgSkill" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgSkillAdoption" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "adoptedBy" TEXT,
    "adoptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSkillAdoption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgSkillDownload" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSkillDownload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgSkill_orgId_archived_idx" ON "OrgSkill"("orgId", "archived");

-- CreateIndex
CREATE INDEX "OrgSkill_orgId_category_idx" ON "OrgSkill"("orgId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "OrgSkill_orgId_name_key" ON "OrgSkill"("orgId", "name");

-- CreateIndex
CREATE INDEX "OrgSkillAdoption_skillId_idx" ON "OrgSkillAdoption"("skillId");

-- CreateIndex
CREATE INDEX "OrgSkillAdoption_orgId_idx" ON "OrgSkillAdoption"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgSkillAdoption_skillId_repoFullName_key" ON "OrgSkillAdoption"("skillId", "repoFullName");

-- CreateIndex
CREATE UNIQUE INDEX "OrgSkillDownload_skillId_key" ON "OrgSkillDownload"("skillId");

-- CreateTable: append-only per-use event for an org skill (Feature 2 sync telemetry).
CREATE TABLE "OrgSkillEvent" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "repo" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSkillEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgSkillEvent_skillId_idx" ON "OrgSkillEvent"("skillId");

-- CreateIndex
CREATE INDEX "OrgSkillEvent_orgId_createdAt_idx" ON "OrgSkillEvent"("orgId", "createdAt");

-- CreateTable: org-scoped API token for machine access to the Skills Library (hash-at-rest).
CREATE TABLE "OrgApiToken" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "createdBy" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgApiToken_tokenHash_key" ON "OrgApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OrgApiToken_orgId_idx" ON "OrgApiToken"("orgId");


-- CreateTable: Shared Org Memory (Memory-as-a-Service MVP) — the org's durable, agent-readable
-- knowledge store. `orgId` leads every query (the tenant boundary); `namespace` groups within an org.
-- `supersededBy` + `confidence` + `source` are the anti-memory-poisoning triad. See prisma/schema.prisma.
CREATE TABLE "OrgMemory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "namespace" TEXT,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'semantic',
    "visibility" TEXT NOT NULL DEFAULT 'shared',
    "source" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "supersededBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgMemory_orgId_archived_idx" ON "OrgMemory"("orgId", "archived");

-- CreateIndex
CREATE INDEX "OrgMemory_orgId_namespace_idx" ON "OrgMemory"("orgId", "namespace");

-- CreateIndex
CREATE INDEX "OrgMemory_orgId_kind_idx" ON "OrgMemory"("orgId", "kind");


-- CreateTable: human decisions on derived findings (security checks, unowned repos, passport
-- blockers, solo-maintained repos) — the state layer behind the org rail's badges.
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
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgDecision_orgId_module_itemKey_key" ON "OrgDecision"("orgId", "module", "itemKey");

-- CreateIndex
CREATE INDEX "OrgDecision_orgId_status_idx" ON "OrgDecision"("orgId", "status");

-- CreateIndex
CREATE INDEX "OrgDecision_orgId_module_idx" ON "OrgDecision"("orgId", "module");


-- CreateTable: auto-derived tech-stack groups (Feature 3b) — repos grouped by detected stack.
CREATE TABLE "TechStackGroup" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechStackGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechStackGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,

    CONSTRAINT "TechStackGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechStackGroup_orgId_idx" ON "TechStackGroup"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TechStackGroup_orgId_key_key" ON "TechStackGroup"("orgId", "key");

-- CreateIndex
CREATE INDEX "TechStackGroupMember_groupId_idx" ON "TechStackGroupMember"("groupId");

-- CreateIndex
CREATE INDEX "TechStackGroupMember_repoId_idx" ON "TechStackGroupMember"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "TechStackGroupMember_groupId_repoId_key" ON "TechStackGroupMember"("groupId", "repoId");


-- CreateTable: per-org connected LLM (BYOM — Feature 1). The credential lives ONLY in the encrypted blob.
CREATE TABLE "OrgLlmConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'bedrock',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "modelId" TEXT NOT NULL,
    "region" TEXT,
    "authMode" TEXT NOT NULL DEFAULT 'static',
    "credentialsEncrypted" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "lastValidationError" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgLlmConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgLlmConfig_orgId_key" ON "OrgLlmConfig"("orgId");


-- CreateTable: cross-instance webhook replay/idempotency store (github-app-installation-webhooks #3).
-- Backs the webhook route's in-memory replay Map with a shared claim keyed on X-GitHub-Delivery, so a
-- replay routed to a different serverless instance is still deduped. A row is the "claimed" mark; deleted
-- on a deferred-processing failure so a redelivery can retry; swept past expiresAt.
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookDelivery_expiresAt_idx" ON "WebhookDelivery"("expiresAt");

-- CreateTable: normalized AI-usage records (integrations increment 2). One row per (source, scope,
-- scopeKey, day). scope=repo carries measured per-repo spend (Claude Code OTel git.repository); scope=org
-- an allocated total (Copilot/OpenAI). Feeds the /delivery AI ROI resolver at the declared fidelity.
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


-- CreateTable
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

-- Seed the shared "public" organization once. Every anonymous scan persists under this org, so
-- seeding it here (idempotently) lets the app resolve it with a plain read instead of upserting the
-- same hot row on every scan — which on Aurora DSQL (optimistic concurrency, no row locks) makes
-- concurrent scans collide on a retryable serialization conflict. See src/lib/db/scans.ts
-- (ensureOrgId) and docs/ARCHITECTURE.md §3. The id is a fixed sentinel UUID (the column is TEXT;
-- under relationMode="prisma" there are no DB-level FKs, so any stable value is fine).
INSERT INTO "Organization" ("id", "slug", "name", "plan")
VALUES ('00000000-0000-4000-8000-000000000001', 'public', 'Public Scans', 'free')
ON CONFLICT ("slug") DO NOTHING;
