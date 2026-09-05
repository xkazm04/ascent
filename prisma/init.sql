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
    "repoMemoryMirror" BOOLEAN,
    "retentionCompact" BOOLEAN,
    "retentionDigestMonths" INTEGER,
    "githubInstallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
-- Idempotent add-column (moonshot wave 1): pglite-boot rewrites CREATE TABLE -> IF NOT EXISTS, so an
-- EXISTING local .pglite DB needs the new columns applied explicitly. All three are NULLABLE, so the
-- boot-time reconcile can add them to a populated dev DB without a backfill.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "repoMemoryMirror" BOOLEAN;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "retentionCompact" BOOLEAN;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "retentionDigestMonths" INTEGER;

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
    "onboardingCompletedAt" TIMESTAMP(3),
    "onboardingSkippedAt" TIMESTAMP(3),

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
-- Idempotent add-column (same rule as Scan's below): pglite-boot rewrites CREATE TABLE -> IF NOT
-- EXISTS, so an EXISTING local .pglite DB needs the new column applied explicitly.
ALTER TABLE "Membership" ADD COLUMN IF NOT EXISTS "alertsSeenAt" TIMESTAMP(3);
-- Onboarding stamp (W6a): idempotent add-column + ONE-TIME backfill in a guarded DO block, NOT a
-- bare ALTER + UPDATE. pglite-boot re-execs this file on EVERY boot, so a bare
-- "UPDATE ... WHERE ... IS NULL" would re-stamp memberships created since the last restart and the
-- onboarding flow could never fire locally. Guarding on "column absent" makes the backfill run
-- exactly once — the moment the columns first land on an EXISTING dev DB — matching the real
-- migration's semantics: existing memberships are stamped completed (never ambushed by a flow for
-- a workspace they already use), only NEW memberships start null. A fresh DB takes the columns from
-- the CREATE TABLE above (zero rows to backfill) and skips this block on every boot thereafter.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Membership' AND column_name = 'onboardingCompletedAt'
  ) THEN
    ALTER TABLE "Membership" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
    ALTER TABLE "Membership" ADD COLUMN "onboardingSkippedAt" TIMESTAMP(3);
    UPDATE "Membership" SET "onboardingCompletedAt" = CURRENT_TIMESTAMP;
  END IF;
END $$;

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
    "contextHealthJson" TEXT,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "headSha" TEXT,
    "headEtag" TEXT,
    "watched" BOOLEAN NOT NULL DEFAULT false,
    "localPath" TEXT,
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
    "role" TEXT NOT NULL DEFAULT 'fleet',
    "manifestJson" TEXT,
    "guidanceGraphJson" TEXT,
    -- MOONSHOT #4 — which forge this repo lives on, and its forge-native stable id. `forge` is
    -- DEFAULTED, so every existing row is GitHub and no backfill is owed; it is a filter, never part
    -- of the identity key (see the Repository_orgId_fullName_key note below).
    "forge" TEXT NOT NULL DEFAULT 'github',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);
-- Idempotent add-column (same rule as Scan's below): pglite-boot rewrites CREATE TABLE -> IF NOT
-- EXISTS, so an EXISTING local .pglite DB needs the new column applied explicitly.
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "missingSince" TIMESTAMP(3);
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "contextHealthJson" TEXT;
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'fleet';
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "manifestJson" TEXT;
-- MOONSHOT #15 — latest arbitrated guidance graph. Nullable: null is "no scan has assessed this
-- repo's guidance yet", which is not "this repo has no guidance" and never a zero.
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "guidanceGraphJson" TEXT;
-- MOONSHOT #4 — forge neutrality. `forge` carries a DEFAULT so an existing row is correctly GitHub
-- without a backfill pass; `externalId` is nullable because the coordinate IS the id on GitHub, and
-- null must never be read as "this repo has no id".
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "forge" TEXT NOT NULL DEFAULT 'github';
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "externalId" TEXT;

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
    "revertedByPr" INTEGER,
    "revertedAt" TIMESTAMP(3),
    "mergeCommitSha" TEXT,
    -- moonshot wave 3 (#1): how this row reached us, and when the approval was OBSERVED (webhook
    -- delivery time) as distinct from `approvedAt` (the review's own submission time).
    "source" TEXT NOT NULL DEFAULT 'scan',
    "approvalObservedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiChange_pkey" PRIMARY KEY ("id")
);
-- Idempotent add-column (same rule as Membership's and Repository's above): pglite-boot rewrites
-- CREATE TABLE -> IF NOT EXISTS, so an EXISTING local .pglite DB never receives a column added to the
-- block above. Here that omission was not merely a missing column — `AiChange_orgId_mergeCommitSha_idx`
-- below is declared OVER one of them, and an index over a missing column throws 42703, which aborts
-- the whole bootstrap and leaves the adapter uninstalled (the boot then reports NO-DB and every read
-- comes back empty). Any new column on an existing table needs its ALTER here.
ALTER TABLE "AiChange" ADD COLUMN IF NOT EXISTS "revertedByPr" INTEGER;
ALTER TABLE "AiChange" ADD COLUMN IF NOT EXISTS "revertedAt" TIMESTAMP(3);
ALTER TABLE "AiChange" ADD COLUMN IF NOT EXISTS "mergeCommitSha" TEXT;

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
    "practiceShape" TEXT,
    "governance" TEXT,
    "commitActivity" TEXT,
    "techStackJson" TEXT,
    "passportJson" TEXT,
    "contextHealthJson" TEXT,
    "warningsJson" TEXT,
    "aiUsageJson" TEXT,
    "rubricVersion" TEXT,
    "engineByom" BOOLEAN,
    "engineDegraded" BOOLEAN,
    "scoreIntegrityJson" TEXT,
    "platformSignalsJson" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "llmLatencyMs" INTEGER,
    "manifestJson" TEXT,
    "guidanceGraphJson" TEXT,
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
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "contextHealthJson" TEXT;
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "manifestJson" TEXT;
-- MOONSHOT #15 — per-scan arbitrated guidance graph. Null = a pre-#15 scan, never "no guidance".
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "guidanceGraphJson" TEXT;
-- Scan provenance: the mock-floor degrade flag and the ScoreIntegrity record. See the
-- 20260828140000_add_scan_provenance migration for why `engineProvider = 'mock'` cannot carry the
-- first on its own.
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "engineDegraded" BOOLEAN;
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "scoreIntegrityJson" TEXT;
-- What this scan could SEE of the GitHub-side platform signals — observed / carried from an earlier
-- scan / unavailable. See the 20260828160000_add_scan_platform_signals migration.
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "platformSignalsJson" TEXT;

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
    "firstStep" TEXT NOT NULL DEFAULT '',
    "explore" TEXT NOT NULL DEFAULT '[]',
    "levelUnlock" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "kind" TEXT NOT NULL DEFAULT 'gap',
    -- r12: the craft axis this entry raises (architecture | performance | robustness | design |
    -- security-depth | dx). Nullable, so pglite-boot's reconcileColumnDrift adds it in place.
    "craftAxis" TEXT,
    "assigneeLogin" TEXT,
    "targetDate" TIMESTAMP(3),
    -- MOONSHOT #3 — the agent-neutral work claim, deliberately separate from "assigneeLogin" (the
    -- human planning layer): a lease expiring must never silently un-assign a person. NULL
    -- "leaseUntil" on an in_progress row means a HUMAN took it and the sweep must leave it alone.
    "claimActor" TEXT,
    "claimExecutor" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "needsHuman" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- Idempotent add-column: pglite-boot rewrites CREATE TABLE -> IF NOT EXISTS, so an EXISTING local
-- .pglite DB needs the four claim columns applied explicitly. All four are safe without a backfill —
-- an unclaimed row is exactly NULL/NULL/NULL/false, which is what every pre-#3 row is.
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "claimActor" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "claimExecutor" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3);
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "needsHuman" BOOLEAN NOT NULL DEFAULT false;

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
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "repoFullName" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "sinkKind" TEXT,
    "suppressedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
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
    "baselineValue" INTEGER,
    "baselineAt" TIMESTAMP(3),

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
    "source" TEXT NOT NULL DEFAULT 'practice',
    "loopLaneId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementPr_pkey" PRIMARY KEY ("id")
);
-- MOONSHOT #26 — which surface opened the PR, and the loop lane behind it. Defaulted, so every
-- existing row keeps its meaning ("practice") without a backfill. The @@unique on
-- (orgId, repoFullName, practiceId) is deliberately UNCHANGED: a loop row's practiceId is the
-- synthetic "loop:<laneId>", unique by construction and therefore idempotent under retry.
ALTER TABLE "ImprovementPr" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'practice';
ALTER TABLE "ImprovementPr" ADD COLUMN IF NOT EXISTS "loopLaneId" TEXT;

-- CreateIndex
CREATE INDEX "ImprovementPr_orgId_loopLaneId_idx" ON "ImprovementPr"("orgId", "loopLaneId");

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
-- MOONSHOT #4 deliberately does NOT widen this to (orgId, forge, fullName): a non-GitHub repo is
-- namespaced in the VALUE ("gitlab:group/sub/project"), so there is no collision to migrate a live
-- unique constraint for, and every route taking ?repo=owner/name keeps working unchanged.
CREATE UNIQUE INDEX "Repository_orgId_fullName_key" ON "Repository"("orgId", "fullName");

-- CreateIndex: MOONSHOT #4 — the fleet-by-forge filter and the honest-capability rollup.
CREATE INDEX "Repository_orgId_forge_idx" ON "Repository"("orgId", "forge");

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

-- CreateIndex: MOONSHOT #3 — the claim's compare-and-set candidate scan and the expired-lease sweep
-- both key on (status, leaseUntil).
CREATE INDEX "Recommendation_status_leaseUntil_idx" ON "Recommendation"("status", "leaseUntil");

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
CREATE INDEX "AlertEvent_orgId_createdAt_idx" ON "AlertEvent"("orgId", "createdAt");

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
    "origin" TEXT NOT NULL DEFAULT 'hosted',
    "registryId" TEXT,
    "registryPath" TEXT,
    "registryHash" TEXT,
    "registryVersion" TEXT,
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

-- Idempotent add-column (same rule as Repository's above): pglite-boot rewrites CREATE TABLE -> IF
-- NOT EXISTS, so an EXISTING local .pglite DB needs the registry-mirror columns applied explicitly —
-- and the index below is over one of them, so it must land first.
ALTER TABLE "OrgSkill" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'hosted';
ALTER TABLE "OrgSkill" ADD COLUMN IF NOT EXISTS "registryId" TEXT;
ALTER TABLE "OrgSkill" ADD COLUMN IF NOT EXISTS "registryPath" TEXT;
ALTER TABLE "OrgSkill" ADD COLUMN IF NOT EXISTS "registryHash" TEXT;
ALTER TABLE "OrgSkill" ADD COLUMN IF NOT EXISTS "registryVersion" TEXT;

-- CreateIndex
CREATE INDEX "OrgSkill_registryId_registryPath_idx" ON "OrgSkill"("registryId", "registryPath");

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
    "detail" TEXT,
    "sessionId" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSkillEvent_pkey" PRIMARY KEY ("id")
);
-- Idempotent add-column (moonshot #19): the drift state the CLI used to smuggle into "source", the
-- producer session, and the at-least-once dedupe key. All nullable, so the boot reconcile self-repairs.
ALTER TABLE "OrgSkillEvent" ADD COLUMN IF NOT EXISTS "detail" TEXT;
ALTER TABLE "OrgSkillEvent" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "OrgSkillEvent" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

-- CreateIndex: nullable-unique — NULLs are distinct in Postgres, so a producer that supplies no key
-- keeps today's append behavior and only a keyed producer gets exactly-once.
CREATE UNIQUE INDEX "OrgSkillEvent_skillId_dedupeKey_key" ON "OrgSkillEvent"("skillId", "dedupeKey");

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
    "citedCount" INTEGER NOT NULL DEFAULT 0,
    "notUsefulCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "origin" TEXT NOT NULL DEFAULT 'hosted',
    "registryId" TEXT,
    "registryPath" TEXT,
    "registryHash" TEXT,
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

ALTER TABLE "OrgMemory" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'hosted';
ALTER TABLE "OrgMemory" ADD COLUMN IF NOT EXISTS "registryId" TEXT;
ALTER TABLE "OrgMemory" ADD COLUMN IF NOT EXISTS "registryPath" TEXT;
ALTER TABLE "OrgMemory" ADD COLUMN IF NOT EXISTS "registryHash" TEXT;
-- MOONSHOT #17 — denormalized use-evidence from the MCP citation door. Two counters, never netted:
-- "an agent used this" and "an agent read it and it did not help" call for different actions.
ALTER TABLE "OrgMemory" ADD COLUMN IF NOT EXISTS "citedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrgMemory" ADD COLUMN IF NOT EXISTS "notUsefulCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "OrgMemory_registryId_registryPath_idx" ON "OrgMemory"("registryId", "registryPath");


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

-- CreateTable
CREATE TABLE "SandboxScenario" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "authorLogin" TEXT NOT NULL DEFAULT '',
    "baselineScore" INTEGER NOT NULL,
    "baselineLevel" TEXT NOT NULL,
    "baselineScanAt" TIMESTAMP(3) NOT NULL,
    "overridesJson" TEXT NOT NULL DEFAULT '{}',
    "itemKeysJson" TEXT NOT NULL DEFAULT '[]',
    "projectedScore" INTEGER NOT NULL,
    "projectedLevel" TEXT NOT NULL,
    "projectedDelta" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SandboxScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SandboxScenario_orgId_repoFullName_authorLogin_key" ON "SandboxScenario"("orgId", "repoFullName", "authorLogin");

-- CreateIndex
CREATE INDEX "SandboxScenario_orgId_repoFullName_idx" ON "SandboxScenario"("orgId", "repoFullName");

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "TransitionProgram" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetLevel" TEXT NOT NULL DEFAULT 'L4',
    "targetDate" TIMESTAMP(3),
    "cadence" TEXT NOT NULL DEFAULT 'weekly',
    "baselineAt" TIMESTAMP(3) NOT NULL,
    "baselineJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransitionProgram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransitionProgram_orgId_key" ON "TransitionProgram"("orgId");

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "userKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "commits" INTEGER NOT NULL DEFAULT 0,
    "pullRequests" INTEGER NOT NULL DEFAULT 0,
    "linesAdded" INTEGER NOT NULL DEFAULT 0,
    "linesRemoved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentSession_orgId_source_sessionId_key" ON "AgentSession"("orgId", "source", "sessionId");

-- CreateIndex
CREATE INDEX "AgentSession_orgId_startedAt_idx" ON "AgentSession"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentSession_orgId_repoFullName_idx" ON "AgentSession"("orgId", "repoFullName");

-- CreateTable
CREATE TABLE "PlanEnquiry" (
    "id" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'enterprise',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "fleetSize" TEXT NOT NULL DEFAULT '',
    "areasJson" TEXT NOT NULL DEFAULT '[]',
    "message" TEXT NOT NULL,
    "viewerLogin" TEXT,
    "orgSlug" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanEnquiry_createdAt_idx" ON "PlanEnquiry"("createdAt");

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

-- CreateIndex
CREATE INDEX "AiChange_orgId_mergeCommitSha_idx" ON "AiChange"("orgId", "mergeCommitSha");

-- CreateTable: the customer-owned registry repo ascent onboards, indexes and tracks (UC2 —
-- docs/REGISTRY-AND-CARE-IMPL.md §2). One row per MAPPED registry repo; `canonical` marks the one the
-- fleet views merge first on name collision.
CREATE TABLE "OrgRegistry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repositoryId" TEXT,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "canonical" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'git_native',
    "telemetrySink" TEXT NOT NULL DEFAULT 'off',
    "status" TEXT NOT NULL DEFAULT 'unmapped',
    "lastIndexedAt" TIMESTAMP(3),
    "lastIndexSha" TEXT,
    "catalogSha" TEXT,
    "webhookHealthy" BOOLEAN NOT NULL DEFAULT false,
    "policiesJson" TEXT,
    "migrationJson" TEXT,
    "scaffoldPrUrl" TEXT,
    "lastError" TEXT,
    "skillCount" INTEGER NOT NULL DEFAULT 0,
    "practiceCount" INTEGER NOT NULL DEFAULT 0,
    "memoryCount" INTEGER NOT NULL DEFAULT 0,
    "lessonCount" INTEGER NOT NULL DEFAULT 0,
    -- The registry usage/ lane, aggregated at index time. Ascent READS the lane; the
    -- installations that run skills count locally and contribute. 0 contributors means
    -- nobody is reporting, which is not the same as a fleet that runs nothing.
    "usageInvokes30d" INTEGER NOT NULL DEFAULT 0,
    "usageContributors" INTEGER NOT NULL DEFAULT 0,
    -- knowledge/ lane summary, one entry per Reference Knowledge Bundle, as read from each
    -- bundle's generated index. Ascent reads these numbers; it does not produce them.
    "bundlesJson" TEXT NOT NULL DEFAULT '[]',
    -- Denormalized knowledge-lane counts from the last index pass (moonshot #18).
    "subjectCount" INTEGER NOT NULL DEFAULT 0,
    "signalContributors" INTEGER NOT NULL DEFAULT 0,
    "signalsContributor" TEXT,
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgRegistry_pkey" PRIMARY KEY ("id")
);
-- Idempotent add-column (moonshot #18). The two counts carry a DEFAULT 0 because they are
-- denormalized cache counts an index pass overwrites, not measurements — "not yet indexed" is
-- already expressed by `status`. signalsContributor is nullable: null = the org contributes nothing.
ALTER TABLE "OrgRegistry" ADD COLUMN IF NOT EXISTS "subjectCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrgRegistry" ADD COLUMN IF NOT EXISTS "signalContributors" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrgRegistry" ADD COLUMN IF NOT EXISTS "signalsContributor" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OrgRegistry_orgId_fullName_key" ON "OrgRegistry"("orgId", "fullName");

-- CreateIndex
CREATE INDEX "OrgRegistry_orgId_canonical_idx" ON "OrgRegistry"("orgId", "canonical");

-- CreateTable: published PRACTICE SHAPES mirrored from practices/<slug>/PRACTICE.md in the registry.
-- Distinct from Scan.practiceShape (mined structure of one repo) — this is the CHOSEN shape.
CREATE TABLE "OrgPracticeShape" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL DEFAULT '',
    "dimension" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "appliesWhen" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL DEFAULT 'hosted',
    "registryId" TEXT,
    "registryPath" TEXT,
    "registryHash" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgPracticeShape_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgPracticeShape_orgId_slug_key" ON "OrgPracticeShape"("orgId", "slug");

-- CreateIndex
CREATE INDEX "OrgPracticeShape_orgId_archived_idx" ON "OrgPracticeShape"("orgId", "archived");

-- CreateIndex
CREATE INDEX "OrgPracticeShape_registryId_registryPath_idx" ON "OrgPracticeShape"("registryId", "registryPath");


-- CreateTable
CREATE TABLE "LoopRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdBy" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'curating',
    "reposJson" TEXT NOT NULL DEFAULT '[]',
    "concurrency" INTEGER NOT NULL DEFAULT 2,
    "maxCycles" INTEGER NOT NULL DEFAULT 3,
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "curated" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "effort" TEXT,
    "modelPolicy" TEXT NOT NULL DEFAULT 'single',
    "modelsJson" TEXT NOT NULL DEFAULT '[]',
    "delivery" TEXT,
    "batchSize" INTEGER,
    "agentTimeoutMs" INTEGER,
    "verifyMode" TEXT,
    "verifyTimeoutMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoopRun_pkey" PRIMARY KEY ("id")
);
-- What the run's agents were armed with — the RESOLVED model and reasoning effort, so a lift can be
-- compared across configurations. See the 20260828170000_add_run_agent_config migration.
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "effort" TEXT;
-- MOONSHOT #27 — how the run spends models. `ab` pairs its lanes across two arms so a cost/lift
-- comparison is a measurement rather than a comparison of two runs that differed in other ways.
-- `modelsJson` is TEXT JSON (never jsonb — DSQL/PGlite).
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "modelPolicy" TEXT NOT NULL DEFAULT 'single';
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "modelsJson" TEXT NOT NULL DEFAULT '[]';
-- How the run's work is delivered: branch | land | pr. NULLABLE, and NULL means `branch` — which is
-- what every run written before this column actually did (commit to a throwaway lane branch and leave
-- it). Nullable so PGlite's boot-time `reconcileColumnDrift` can add it in place on an existing
-- embedded database without a migration step.
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "delivery" TEXT;
-- THROUGHPUT + THE DEGRADATION GUARD. All four NULLABLE, and null means "the deployment default" —
-- byte-identical to what every run before these columns did. `batchSize` null = 5 (the value that used
-- to be hard-coded); `agentTimeoutMs` null = ASCENT_AUTOPILOT_TIMEOUT_MS (20 min); `verifyMode` null =
-- 'on' (the A/B degradation guard is the default posture, and 'off' is an explicit refusal to run
-- repo-authored verification commands); `verifyTimeoutMs` null = 10 minutes.
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "batchSize" INTEGER;
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "agentTimeoutMs" INTEGER;
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "verifyMode" TEXT;
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "verifyTimeoutMs" INTEGER;

-- CreateIndex
CREATE INDEX "LoopRun_orgId_createdAt_idx" ON "LoopRun"("orgId", "createdAt");

-- CreateTable: one repo's work for one cycle — the unit of parallelism, of retry, and of the UI row.
CREATE TABLE "LoopRunLane" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "branch" TEXT,
    "batchIdsJson" TEXT NOT NULL DEFAULT '[]',
    "closedIdsJson" TEXT NOT NULL DEFAULT '[]',
    "commits" INTEGER NOT NULL DEFAULT 0,
    "beforeScanId" TEXT,
    "afterScanId" TEXT,
    "stage" TEXT,
    "log" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "model" TEXT,
    "costSource" TEXT,
    "costMicros" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "turns" INTEGER,
    "agentDurationMs" INTEGER,
    "agentSessionId" TEXT,
    "abPairKey" TEXT,
    "briefJson" TEXT NOT NULL DEFAULT '{}',
    "reportJson" TEXT NOT NULL DEFAULT '{}',
    "dimId" TEXT,
    "prNumber" INTEGER,
    "prUrl" TEXT,
    "executor" TEXT NOT NULL DEFAULT 'local',
    "claimedBy" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "deliverablesJson" TEXT,
    "verifyVerdict" TEXT,
    "verifyCommand" TEXT,
    "verifyNote" TEXT,
    "verifyRung" TEXT,

    CONSTRAINT "LoopRunLane_pkey" PRIMARY KEY ("id")
);
-- MOONSHOT #27 — lane economics. ONE declared cost source per lane, never a sum of two. Every
-- measurement is nullable: a lane whose agent reported nothing is UNKNOWN, and a 0 in its place
-- would be averaged as a free session. `costMicros` is MICRO-CENTS
-- (round(total_cost_usd * 100 * 1e6)), so a 0.4¢ session is not rounded away; readers divide.
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "costSource" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "costMicros" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "inputTokens" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "outputTokens" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "cacheReadTokens" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "turns" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "agentDurationMs" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "agentSessionId" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "abPairKey" TEXT;
-- MOONSHOT #25 — the lane's brief PROVENANCE and the agent's own report, verbatim after validation.
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "briefJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "reportJson" TEXT NOT NULL DEFAULT '{}';
-- MOONSHOT #26 — the lane's PR, denormalized so the cockpit renders it without a join. `dimId` is an
-- honest null when the batch was empty or spanned no single dimension.
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "dimId" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "prNumber" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "prUrl" TEXT;
-- MOONSHOT #3 — the work lease, landed here and DELIBERATELY UNUSED until W4-N (00-INDEX §5 Wave 2).
-- `executor` defaults to 'local' so every existing lane keeps exactly its current meaning.
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "executor" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "claimedBy" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3);
-- WAVE 2 — the lane's deliverable headlines (JSON LaneDeliverable[]); NULL = derive on read.
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "deliverablesJson" TEXT;
-- THE A/B DEGRADATION GUARD — what the repository's OWN verification command said before and after the
-- agent's session: verified | rejected | baseline-red | skipped. NULL is NOT 'skipped'; it is a lane
-- written before the guard existed, whose verification state is unknown. A 'rejected' lane committed
-- nothing and is never landed or PR'd, whatever delivery mode the run asked for.
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "verifyVerdict" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "verifyCommand" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "verifyNote" TEXT;
-- WHICH RUNG of the narrowing ladder `verifyCommand` was: 'primary' | 'typecheck' | 'lint'. A git
-- worktree is not a runnable environment for a realistic app (no gitignored credentials, service
-- config or local database), so when the declared command cannot establish a baseline there the guard
-- degrades to the strongest HERMETIC check that can. A lane verified against `npm run typecheck` has
-- NOT been verified against the repository's tests. NULL = a lane written before the ladder; never
-- read as 'primary'.
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "verifyRung" TEXT;

-- CreateIndex
CREATE INDEX "LoopRunLane_runId_idx" ON "LoopRunLane"("runId");

-- CreateTable: a DRIVE — the sequence of loop runs that pulls a fleet toward green. Durable so a
-- restart mid-drive reports `interrupted` instead of nothing, and can be resumed by a human.
CREATE TABLE "LoopDrive" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdBy" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'running',
    "reposJson" TEXT NOT NULL DEFAULT '[]',
    "maxRuns" INTEGER NOT NULL DEFAULT 3,
    "maxCycles" INTEGER NOT NULL DEFAULT 3,
    "concurrency" INTEGER NOT NULL DEFAULT 2,
    "runsBefore" INTEGER NOT NULL DEFAULT 0,
    "resumedFrom" TEXT,
    "runsJson" TEXT NOT NULL DEFAULT '[]',
    "measurementJson" TEXT,
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "effort" TEXT,
    "delivery" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "LoopDrive_pkey" PRIMARY KEY ("id")
);
-- The same pair on the drive, so every run it dispatches inherits ONE configuration.
ALTER TABLE "LoopDrive" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "LoopDrive" ADD COLUMN IF NOT EXISTS "effort" TEXT;
-- And the delivery mode every run the drive dispatches inherits, so a RESUME continues the same
-- experiment. NULL means `branch`.
ALTER TABLE "LoopDrive" ADD COLUMN IF NOT EXISTS "delivery" TEXT;

-- CreateIndex
CREATE INDEX "LoopDrive_orgId_startedAt_idx" ON "LoopDrive"("orgId", "startedAt");


-- ATHENA — the resident, ORG-SCOPED companion. Her EPISODES are NOT here: they are OrgMemory rows
-- (namespace "athena", kind "episodic", source "athena"). Her IDENTITY needs its own table because
-- OrgMemory cannot express immutability, a "constitution" kind, or decay exemption. See the schema.

-- CreateTable: one conversation. `title` is DERIVED from the first user message and never typed.
CREATE TABLE "AthenaThread" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AthenaThread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AthenaThread_orgId_updatedAt_idx" ON "AthenaThread"("orgId", "updatedAt");

-- CreateTable: one message. The token columns are NULLABLE on purpose — a provider that reports no
-- usage is UNKNOWN, not zero, and a 0 would be summed downstream as if it had been measured.
CREATE TABLE "AthenaTurn" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "legs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AthenaTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AthenaTurn_threadId_createdAt_idx" ON "AthenaTurn"("threadId", "createdAt");

-- CreateTable: something she asked for that a human has not answered yet. The resolution OUTCOME is
-- merged into "payloadJson" rather than given a column of its own — an outcome is kind-shaped.
CREATE TABLE "AthenaProposal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AthenaProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AthenaProposal_orgId_status_idx" ON "AthenaProposal"("orgId", "status");

-- CreateIndex
CREATE INDEX "AthenaProposal_threadId_idx" ON "AthenaProposal"("threadId");

-- CreateTable: her identity, two tiers, one row each per org. "content" is markdown with stable
-- "## " sections so the anchored-diff engine has real anchors to bind to.
CREATE TABLE "AthenaIdentity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AthenaIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one constitution and one self-model per org — "one mind per organization" as a fact
-- of the schema, not a convention the read layer hopes for.
CREATE UNIQUE INDEX "AthenaIdentity_orgId_tier_key" ON "AthenaIdentity"("orgId", "tier");

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- MOONSHOT WAVE 1 (docs/specs/moonshot/00-INDEX.md §5). Every JSON payload below is TEXT, never
-- jsonb (DSQL/PGlite). Every column that reports a MEASUREMENT is nullable — a provider or a payload
-- that reported nothing is UNKNOWN, and a 0 in its place would be summed as if it had been measured.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable: #9 measured lift per intervention. Rows are written ONLY when both scan bookends
-- exist and the rubric + engine matched on both sides, so the aggregate can hold no fabricated zero.
CREATE TABLE "InterventionOutcome" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    -- HONEST NULL: a whole-scan outcome (a scenario) has no dimension, which is not dimension "0".
    "dimId" TEXT,
    "beforeScanId" TEXT NOT NULL,
    "afterScanId" TEXT NOT NULL,
    "interventionAt" TIMESTAMP(3) NOT NULL,
    "overallDelta" INTEGER NOT NULL,
    "dimDelta" INTEGER,
    "rubricVersion" TEXT NOT NULL,
    "engineProvider" TEXT NOT NULL,
    "gapDays" INTEGER NOT NULL,
    "withinBound" BOOLEAN NOT NULL,
    "isPrivateRepo" BOOLEAN NOT NULL,
    "sourceRowId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterventionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the idempotency key — recordOutcome upserts on it, so re-running a read path that
-- mirrors outcomes writes nothing new.
CREATE UNIQUE INDEX "InterventionOutcome_orgId_kind_identityKey_beforeScanId_afterScanId_key" ON "InterventionOutcome"("orgId", "kind", "identityKey", "beforeScanId", "afterScanId");

-- CreateIndex
CREATE INDEX "InterventionOutcome_orgId_kind_dimId_idx" ON "InterventionOutcome"("orgId", "kind", "dimId");

-- CreateIndex
CREATE INDEX "InterventionOutcome_identityKey_dimId_idx" ON "InterventionOutcome"("identityKey", "dimId");

-- CreateIndex
CREATE INDEX "InterventionOutcome_orgId_recordedAt_idx" ON "InterventionOutcome"("orgId", "recordedAt");

-- CreateTable: #11 one row per metered LLM leg (or per tool loop). The token and cost columns are
-- NULLABLE on purpose — a provider that reports no usage is UNKNOWN, not zero.
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "legKind" TEXT,
    "refId" TEXT,
    "repoId" TEXT,
    "repoFullName" TEXT,
    "teamKey" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "byom" BOOLEAN,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "costMicros" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'success',
    "latencyMs" INTEGER,
    "idemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: nullable-unique. NULLs are distinct, so an unkeyed caller is unconstrained (the
-- intended at-least-once fallback) and a keyed one is exactly-once. Scan.dedupKey's precedent.
CREATE UNIQUE INDEX "UsageEvent_idemKey_key" ON "UsageEvent"("idemKey");

-- CreateIndex
CREATE INDEX "UsageEvent_orgId_createdAt_idx" ON "UsageEvent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_orgId_lane_createdAt_idx" ON "UsageEvent"("orgId", "lane", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_orgId_teamKey_createdAt_idx" ON "UsageEvent"("orgId", "teamKey", "createdAt");

-- CreateTable: #14 one entry mirrored out of a repo's .ai/memory/. Repo-authored content, held in
-- quarantine: capped by the parser, never scored, and skipReason records why an entry stopped here.
CREATE TABLE "RepoMemoryMirror" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "entryId" TEXT,
    "rawKind" TEXT,
    "mappedKind" TEXT NOT NULL,
    "scope" TEXT,
    -- VERBATIM frontmatter text, not a timestamp: it is repo-authored and may not be a date at all.
    "entryDate" TEXT,
    "supersedes" TEXT,
    "refsJson" TEXT NOT NULL DEFAULT '[]',
    "body" TEXT NOT NULL,
    "headSha" TEXT,
    "superseded" BOOLEAN NOT NULL DEFAULT false,
    "orgMemoryId" TEXT,
    "skipReason" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoMemoryMirror_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepoMemoryMirror_orgId_repoFullName_path_contentHash_key" ON "RepoMemoryMirror"("orgId", "repoFullName", "path", "contentHash");

-- CreateIndex
CREATE INDEX "RepoMemoryMirror_orgId_repoFullName_idx" ON "RepoMemoryMirror"("orgId", "repoFullName");

-- CreateIndex
CREATE INDEX "RepoMemoryMirror_orgId_mappedKind_idx" ON "RepoMemoryMirror"("orgId", "mappedKind");

-- CreateTable: #16 one doctor run reported back by a repo. The denormalized summary already lives on
-- Repository.aiConformance*; this is the per-check ledger that turns "78%" into a control matrix.
CREATE TABLE "ConformanceReport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "headSha" TEXT,
    "score" INTEGER NOT NULL,
    "fails" INTEGER NOT NULL,
    "warns" INTEGER NOT NULL,
    "unchecked" INTEGER NOT NULL DEFAULT 0,
    "scored" INTEGER NOT NULL DEFAULT 0,
    "specVersion" TEXT,
    "runShape" TEXT NOT NULL DEFAULT 'plain',
    "summaryOnly" BOOLEAN NOT NULL DEFAULT false,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConformanceReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConformanceReport_orgId_repoFullName_headSha_runShape_key" ON "ConformanceReport"("orgId", "repoFullName", "headSha", "runShape");

-- CreateIndex
CREATE INDEX "ConformanceReport_orgId_repoFullName_reportedAt_idx" ON "ConformanceReport"("orgId", "repoFullName", "reportedAt");

-- CreateTable: #16 one check inside a report. relationMode = "prisma" emits no FK here, so the
-- schema's onDelete: Cascade is client-side only and retention.ts deletes findings by hand.
CREATE TABLE "ConformanceFinding" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ConformanceFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConformanceFinding_reportId_idx" ON "ConformanceFinding"("reportId");

-- CreateIndex
CREATE INDEX "ConformanceFinding_check_idx" ON "ConformanceFinding"("check");

-- CreateTable: #19 the registry usage/<contributor>.json lane, upserted per index pass. No repo
-- dimension exists here and none can be derived — that lane forbids repository names and paths.
CREATE TABLE "OrgSkillUsageSample" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contributor" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "invokes" INTEGER NOT NULL DEFAULT 0,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    -- NULL = the file reported no lastUsed. Not "never used".
    "lastUsedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSkillUsageSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgSkillUsageSample_registryId_contributor_skillName_key" ON "OrgSkillUsageSample"("registryId", "contributor", "skillName");

-- CreateIndex
CREATE INDEX "OrgSkillUsageSample_orgId_skillName_idx" ON "OrgSkillUsageSample"("orgId", "skillName");

-- CreateTable: #18 one subject in a knowledge bundle's generated index. Ascent reads this lane; the
-- bundle's own generator owns every field, so nothing here is authored by ascent.
CREATE TABLE "OrgKnowledgeSubject" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "bundle" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT,
    "subcategory" TEXT,
    "status" TEXT,
    "file" TEXT NOT NULL,
    "techniqueCount" INTEGER NOT NULL DEFAULT 0,
    "useWhenJson" TEXT NOT NULL DEFAULT '[]',
    "lawsJson" TEXT NOT NULL DEFAULT '[]',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "indexedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgKnowledgeSubject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgKnowledgeSubject_registryId_bundle_slug_key" ON "OrgKnowledgeSubject"("registryId", "bundle", "slug");

-- CreateIndex
CREATE INDEX "OrgKnowledgeSubject_orgId_bundle_idx" ON "OrgKnowledgeSubject"("orgId", "bundle");

-- CreateTable: #18 the HEADER of one repo's .ai/registry-map.json — the counts and provenance, so a
-- reader can tell "judged 3 of 40 pairs" apart from "conformant".
CREATE TABLE "RepoConformanceMap" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "mapSha" TEXT NOT NULL,
    "schema" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "contexts" INTEGER NOT NULL,
    "pairs" INTEGER NOT NULL,
    "judged" INTEGER NOT NULL,
    "deviations" INTEGER NOT NULL,
    "weaklyGoverned" INTEGER NOT NULL,
    "weaklyGovernedJson" TEXT NOT NULL DEFAULT '[]',
    "unmatched" INTEGER NOT NULL,
    "domainsJson" TEXT NOT NULL DEFAULT '[]',
    "bundleDigestsJson" TEXT NOT NULL DEFAULT '{}',
    -- NULL = the map carried no consult lane. That is NOT "zero consults".
    "consults30d" INTEGER,
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "ingestedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoConformanceMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepoConformanceMap_repositoryId_key" ON "RepoConformanceMap"("repositoryId");

-- Director addendum deferred from wave 1: the weakly-governed contexts BY NAME. The list is not
-- derivable from the counts or from RepoConformance (a context with no judged pair leaves no row),
-- so without it "3 weakly governed" names nothing a reader can act on. TEXT JSON string[].
ALTER TABLE "RepoConformanceMap" ADD COLUMN IF NOT EXISTS "weaklyGovernedJson" TEXT NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "RepoConformanceMap_orgId_idx" ON "RepoConformanceMap"("orgId");

-- CreateTable: #18 one judged (context x subject) pair — the standing deviation backlog, as the
-- repo's own /conform runs wrote it.
CREATE TABLE "RepoConformance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "contextName" TEXT NOT NULL,
    "contextGroup" TEXT,
    "bundle" TEXT NOT NULL,
    "subjectSlug" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "confidence" TEXT,
    "score" DOUBLE PRECISION,
    "evidence" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "evaluatedAgainst" TEXT,
    "mapSha" TEXT NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoConformance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepoConformance_repositoryId_contextName_subjectSlug_key" ON "RepoConformance"("repositoryId", "contextName", "subjectSlug");

-- CreateIndex
CREATE INDEX "RepoConformance_orgId_subjectSlug_state_idx" ON "RepoConformance"("orgId", "subjectSlug", "state");

-- CreateTable: #18 the signals/ lane as one contributor published it. EVERY COUNT IS NULLABLE: a key
-- the payload did not carry is NULL (nothing was reported), never 0 (nobody consulted it).
CREATE TABLE "RegistrySignal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "contributor" TEXT NOT NULL,
    "app" TEXT,
    "bundle" TEXT NOT NULL,
    "subjectSlug" TEXT NOT NULL,
    "consults" INTEGER,
    "deviations" INTEGER,
    "citResolved" INTEGER,
    "citMoved" INTEGER,
    "citGone" INTEGER,
    "windowDays" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrySignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrySignal_registryId_contributor_bundle_subjectSlug_key" ON "RegistrySignal"("registryId", "contributor", "bundle", "subjectSlug");

-- CreateIndex
CREATE INDEX "RegistrySignal_orgId_bundle_idx" ON "RegistrySignal"("orgId", "bundle");

-- CreateTable: #18 audit row for one signals contribution ascent opened back to the registry.
-- Deliberately WITHOUT a unique key beyond the id: the same payload may legitimately be contributed
-- twice, and collapsing those two acts would erase half the trail.
CREATE TABLE "RegistrySignalContribution" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "contributor" TEXT NOT NULL,
    "prUrl" TEXT,
    "commitSha" TEXT,
    "payloadDigest" TEXT NOT NULL,
    "bundlesJson" TEXT NOT NULL DEFAULT '[]',
    "subjects" INTEGER NOT NULL,
    "deviations" INTEGER NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrySignalContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistrySignalContribution_orgId_createdAt_idx" ON "RegistrySignalContribution"("orgId", "createdAt");

-- CreateTable: #36 one "## " entry in skills/<name>/LESSONS.md. Heading slots are stored VERBATIM —
-- a version that did not parse stays '' rather than being guessed — and headingRaw keeps the line.
CREATE TABLE "OrgSkillLesson" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "registryPath" TEXT NOT NULL,
    "versionUsed" TEXT NOT NULL DEFAULT '',
    -- NULL = the heading carried no readable date.
    "learnedOn" TIMESTAMP(3),
    "project" TEXT NOT NULL DEFAULT '',
    "headingRaw" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "entryHash" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "memoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSkillLesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgSkillLesson_registryId_registryPath_entryHash_key" ON "OrgSkillLesson"("registryId", "registryPath", "entryHash");

-- CreateIndex
CREATE INDEX "OrgSkillLesson_orgId_skillName_idx" ON "OrgSkillLesson"("orgId", "skillName");

-- CreateIndex
CREATE INDEX "OrgSkillLesson_registryId_registryPath_idx" ON "OrgSkillLesson"("registryId", "registryPath");

-- CreateTable: #36 per-skill git timeline cache, one row per registry path. headSha is the cache
-- key: a trace built at a different head is stale and rebuilt rather than served.
CREATE TABLE "OrgSkillTrace" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "registryPath" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "entriesJson" TEXT NOT NULL DEFAULT '[]',
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSkillTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgSkillTrace_registryId_registryPath_key" ON "OrgSkillTrace"("registryId", "registryPath");

-- CreateIndex
CREATE INDEX "OrgSkillTrace_orgId_skillName_idx" ON "OrgSkillTrace"("orgId", "skillName");

-- CreateTable: #36 a reflection that must land as a PR, and its state. The registry is git-native:
-- ascent PROPOSES a consolidated memory and never writes one directly.
CREATE TABLE "OrgMemoryProposal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "registryId" TEXT,
    "namespace" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'summary',
    "slug" TEXT NOT NULL,
    "summaryContent" TEXT NOT NULL,
    "memberIdsJson" TEXT NOT NULL DEFAULT '[]',
    "memberPathsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "prUrl" TEXT,
    "prNumber" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgMemoryProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgMemoryProposal_orgId_slug_key" ON "OrgMemoryProposal"("orgId", "slug");

-- CreateIndex
CREATE INDEX "OrgMemoryProposal_orgId_status_idx" ON "OrgMemoryProposal"("orgId", "status");

-- CreateTable: #32 a compacted month of one repo's scan history. SUMS, not means, so an upsert folds
-- a later page exactly. rubricVersion is NOT NULL with an 'unknown' sentinel — it sits in the unique
-- key, and NULLs being distinct would make every legacy month its own bucket forever.
CREATE TABLE "ScanDigest" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "rubricVersion" TEXT NOT NULL,
    "engineProvider" TEXT NOT NULL,
    "scanCount" INTEGER NOT NULL,
    "overallSum" INTEGER NOT NULL,
    "adoptionSum" INTEGER NOT NULL,
    "rigorSum" INTEGER NOT NULL,
    "overallMin" INTEGER NOT NULL,
    "overallMax" INTEGER NOT NULL,
    "overallLast" INTEGER NOT NULL,
    "adoptionLast" INTEGER NOT NULL,
    "rigorLast" INTEGER NOT NULL,
    "confidenceSum" DOUBLE PRECISION NOT NULL,
    "levelLast" TEXT NOT NULL,
    "levelNameLast" TEXT NOT NULL,
    "postureLast" TEXT NOT NULL,
    "firstScannedAt" TIMESTAMP(3) NOT NULL,
    "lastScannedAt" TIMESTAMP(3) NOT NULL,
    "firstHeadSha" TEXT,
    "lastHeadSha" TEXT,
    "enginesJson" TEXT NOT NULL DEFAULT '[]',
    "dimensionsJson" TEXT NOT NULL DEFAULT '{}',
    "recsOpened" INTEGER NOT NULL DEFAULT 0,
    "recsClosed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScanDigest_repoId_period_rubricVersion_engineProvider_key" ON "ScanDigest"("repoId", "period", "rubricVersion", "engineProvider");

-- CreateIndex
CREATE INDEX "ScanDigest_repoId_lastScannedAt_idx" ON "ScanDigest"("repoId", "lastScannedAt");

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- MOONSHOT WAVE 2 (docs/specs/moonshot/00-INDEX.md §5 "Wave 2"). Same three rules as wave 1: every
-- JSON payload is TEXT, never jsonb (DSQL/PGlite); every MEASUREMENT column is nullable so an
-- unreported figure stays UNKNOWN instead of becoming a summed zero; and the erase/purge cascades
-- are hand-written in src/lib/db/retention.ts, because relationMode = "prisma" emits no FKs.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- CreateTable: #25 what a lane's agent did with ONE recommendation, as its own lane-report said.
-- `absent` (the report never mentioned the id) is a DIFFERENT verdict from `skipped` (it mentioned
-- it and declined) — only one of those is a reason to stop offering the item.
CREATE TABLE "LaneItemOutcome" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "laneId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    -- The agent's own words. '' means it gave none — never a reason invented on its behalf.
    "reason" TEXT NOT NULL DEFAULT '',
    "filesJson" TEXT NOT NULL DEFAULT '[]',
    "deferUntil" TIMESTAMP(3),
    -- When the RESCAN adjudicated this close (persistScanReport's closedFollowUpIds, past
    -- decideInProgress's movement witness). NULL on every other row — including every row written
    -- before this column existed, which were stamped from the agent's own commit trailers and are
    -- therefore un-adjudicated claims. NULL IS NEVER VERIFIED.
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaneItemOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one verdict per (lane, item) — the idempotency key, so re-parsing a report is a no-op.
CREATE UNIQUE INDEX "LaneItemOutcome_laneId_recommendationId_key" ON "LaneItemOutcome"("laneId", "recommendationId");

-- CreateIndex
CREATE INDEX "LaneItemOutcome_orgId_recommendationId_idx" ON "LaneItemOutcome"("orgId", "recommendationId");

-- CreateIndex
CREATE INDEX "LaneItemOutcome_runId_idx" ON "LaneItemOutcome"("runId");

-- CreateTable: #25 a lesson a lane PROPOSED for org memory, held in review. An agent's summary of
-- its own work is a claim; promoting it unreviewed would let a loop teach the org something no
-- human agreed to. Generic on purpose — #36's skill-lessons channel reuses this table.
CREATE TABLE "OrgMemoryCandidate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "namespace" TEXT,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'procedural',
    "source" TEXT NOT NULL,
    "laneId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "promotedMemoryId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgMemoryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgMemoryCandidate_orgId_status_idx" ON "OrgMemoryCandidate"("orgId", "status");

-- CreateTable: #33 one practice artifact ascent PROPOSED to a repo, and what happened next. The two
-- hashes are the point: `drifted` is a measured divergence between what was committed and what the
-- file looks like now, not an assumption that a merged PR stayed merged. `adoptedHash` stays NULL
-- until the first post-merge scan observes the file — null is "not yet observed", not "unchanged".
CREATE TABLE "PracticeAdoption" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    -- NULL unless source = 'house': a generic artifact has no house-pattern version, which is not 0.
    "patternVersion" INTEGER,
    "artifactPath" TEXT NOT NULL,
    "proposedHash" TEXT NOT NULL,
    "adoptedHash" TEXT,
    "adoptedOutline" TEXT,
    "state" TEXT NOT NULL DEFAULT 'proposed',
    "improvementPrId" TEXT,
    "prNumber" INTEGER,
    "adoptedAt" TIMESTAMP(3),
    "driftedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastScanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeAdoption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PracticeAdoption_orgId_repoFullName_practiceId_artifactPath_key" ON "PracticeAdoption"("orgId", "repoFullName", "practiceId", "artifactPath");

-- CreateIndex
CREATE INDEX "PracticeAdoption_orgId_state_idx" ON "PracticeAdoption"("orgId", "state");

-- CreateIndex
CREATE INDEX "PracticeAdoption_orgId_practiceId_patternVersion_idx" ON "PracticeAdoption"("orgId", "practiceId", "patternVersion");

-- CreateTable: #33 an IMMUTABLE version of an org's mined house pattern. Versioned rather than
-- overwritten because an adoption row cites the version it was measured against — a re-mine must not
-- retroactively turn every previously-conformant repo into a drifted one.
CREATE TABLE "HousePatternVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "linesJson" TEXT NOT NULL DEFAULT '[]',
    "exemplarsJson" TEXT NOT NULL DEFAULT '[]',
    "agreementMin" INTEGER NOT NULL DEFAULT 2,
    "patternHash" TEXT NOT NULL,
    "minedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HousePatternVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HousePatternVersion_orgId_practiceId_version_key" ON "HousePatternVersion"("orgId", "practiceId", "version");

-- CreateIndex: the change key — a re-mine producing the same lines writes no new version at all.
CREATE UNIQUE INDEX "HousePatternVersion_orgId_practiceId_patternHash_key" ON "HousePatternVersion"("orgId", "practiceId", "patternHash");

-- CreateIndex
CREATE INDEX "HousePatternVersion_orgId_practiceId_idx" ON "HousePatternVersion"("orgId", "practiceId");

-- CreateTable: #17 an agent telling ascent what it actually USED. One row per (memory, session), so
-- a chatty agent's repeated reads are ONE citation. `used = false` is a first-class fact and is
-- counted separately on OrgMemory.notUsefulCount — never netted against the positive count.
CREATE TABLE "OrgMemoryCitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "tokenId" TEXT,
    "actor" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgMemoryCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgMemoryCitation_memoryId_sessionId_key" ON "OrgMemoryCitation"("memoryId", "sessionId");

-- CreateIndex
CREATE INDEX "OrgMemoryCitation_orgId_createdAt_idx" ON "OrgMemoryCitation"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "OrgMemoryCitation_memoryId_used_idx" ON "OrgMemoryCitation"("memoryId", "used");

-- CreateTable: #10 one unit of queued scan work. The queue exists because the cron worker used to
-- hold the whole fleet in one invocation — a rescan either finished inside the function's cap or was
-- lost with no record that it had been attempted. A row survives the invocation, so "queued",
-- "claimed by an invocation that died" and "settled" stop being the same silence.
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    -- NULL while the import funnel has not created the Repository row yet. `repoFullName` is the
    -- identity the claim keys on and is always present.
    "repoId" TEXT,
    "repoFullName" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "runId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    -- Diagnostics only, never an authorization input: the claim is held by "leaseUntil".
    "claimedBy" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "creditCharged" BOOLEAN NOT NULL DEFAULT false,
    "resultJson" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    -- When the row reached done | failed | skipped — the anchor the 30-day purge horizon measures.
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the enqueue contract. Two producers racing on the same repo in the same bucket (a
-- cadence tick and a webhook) collide here, so the second enqueue is a no-op, not a second charged scan.
CREATE UNIQUE INDEX "ScanJob_idempotencyKey_key" ON "ScanJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ScanJob_lane_state_notBefore_priority_idx" ON "ScanJob"("lane", "state", "notBefore", "priority");

-- CreateIndex
CREATE INDEX "ScanJob_orgId_lane_state_idx" ON "ScanJob"("orgId", "lane", "state");

-- CreateIndex
CREATE INDEX "ScanJob_runId_idx" ON "ScanJob"("runId");

-- CreateIndex
CREATE INDEX "ScanJob_state_leaseUntil_idx" ON "ScanJob"("state", "leaseUntil");

-- CreateTable: #1 + #10 (reconciled) append-only governance evidence — "control X on repo Y was in
-- state S at time T, and here is how we know". One row is one OBSERVATION, never a current-state
-- cache: the posture surfaces read the newest row per (repoFullName, controlId). `state` is
-- pass | fail | unmeasurable and `unmeasurable` is NEVER coerced to `fail` — "we could not see it"
-- and "it is off" are different claims. `occurredAt` is when the state HELD; `observedAt` is when
-- this deployment learned it, and reporting either as the other misdates an auditor's evidence.
CREATE TABLE "ControlObservation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    -- NULL = an org-scoped control (an org SECURITY.md is not a repo's fact). `repoFullName` is
    -- denormalized so the pack and timeline reads never join.
    "repoId" TEXT,
    "repoFullName" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "value" TEXT,
    -- NULL on a pair's first observation — a fact about the history, never a zero.
    "prevValue" TEXT,
    "prevState" TEXT,
    "evidenceJson" TEXT NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL,
    -- Webhook rows only; NEVER fabricated for a scan or probe row (nobody "did" a measurement).
    "actorLogin" TEXT,
    "transition" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanId" TEXT,
    "jobId" TEXT,
    "deliveryId" TEXT,
    -- signAudit() over the canonical fields; NULL = signing is off, never "the signature failed".
    "sig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: a webhook REDELIVERY is a no-op rather than a duplicated observation.
CREATE UNIQUE INDEX "ControlObservation_deliveryId_controlId_repoFullName_key" ON "ControlObservation"("deliveryId", "controlId", "repoFullName");

-- CreateIndex
CREATE INDEX "ControlObservation_orgId_repoFullName_controlId_occurredAt_idx" ON "ControlObservation"("orgId", "repoFullName", "controlId", "occurredAt");

-- CreateIndex
CREATE INDEX "ControlObservation_orgId_occurredAt_idx" ON "ControlObservation"("orgId", "occurredAt");

-- CreateIndex
CREATE INDEX "ControlObservation_repoId_controlId_observedAt_idx" ON "ControlObservation"("repoId", "controlId", "observedAt");

-- CreateIndex
CREATE INDEX "ControlObservation_orgId_transition_observedAt_idx" ON "ControlObservation"("orgId", "transition", "observedAt");

-- CreateTable: #1 one seal per (org, UTC day) — a hash chain over DAYS, not rows (chaining rows would
-- make every append a read-modify-write). `rowCount` and `root` are what make a DELETION detectable:
-- retention purges aged observations but NEVER their seal, so a sealed day whose surviving rows no
-- longer reproduce its root is visibly incomplete instead of silently short.
CREATE TABLE "ControlLedgerSeal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "root" TEXT NOT NULL,
    -- The previous sealed day's root; NULL = the chain's first day.
    "prevRoot" TEXT,
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sig" TEXT,

    CONSTRAINT "ControlLedgerSeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ControlLedgerSeal_orgId_day_key" ON "ControlLedgerSeal"("orgId", "day");

-- CreateIndex
CREATE INDEX "ControlLedgerSeal_orgId_day_idx" ON "ControlLedgerSeal"("orgId", "day");

-- Idempotent add-column (moonshot wave 3, #1): the live-stream reducer's two AiChange columns. Both
-- are additive on an EXISTING local .pglite DB, and both are safe to add without a backfill —
-- `source` defaults to 'scan', which is the true provenance of every row written before the webhook
-- path existed, and `approvalObservedAt` is nullable because a scan-sourced row has no live
-- observation time (null is "not observed live", never "not approved").
ALTER TABLE "AiChange" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'scan';
ALTER TABLE "AiChange" ADD COLUMN IF NOT EXISTS "approvalObservedAt" TIMESTAMP(3);

-- ── MOONSHOT WAVE 4 ────────────────────────────────────────────────────────────────────────────

-- CreateTable: #8 the compiled admission decision for ONE repo — what tier the stance DERIVES for
-- it, what tier the org GRANTED, and therefore whether agents may work in it. The two tiers are
-- separate columns rather than one value plus an "overridden" flag because an override must not
-- destroy the evidence it overrode. "derivedTier" NULL = not assessed (never a T0); "decidedBy"
-- NULL = seeded from the derived tier and never actually decided, which must not read as
-- governance; "rulesetId" NULL = nothing was written to the forge, so there is nothing to revert
-- and no claim that the perimeter is enforced. Keyed by repoFullName with no FK (mirrors
-- OrgArtifactAck), so it is hand-cascaded by src/lib/db/retention.ts.
CREATE TABLE "RepoAdmission" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "stanceVersion" INTEGER NOT NULL,
    "derivedTier" TEXT,
    "grantedTier" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'assisted-only',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rationale" TEXT NOT NULL DEFAULT '',
    "rulesetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoAdmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one decision per (org, repo) — the upsert key.
CREATE UNIQUE INDEX "RepoAdmission_orgId_repoFullName_key" ON "RepoAdmission"("orgId", "repoFullName");

-- CreateIndex
CREATE INDEX "RepoAdmission_orgId_mode_idx" ON "RepoAdmission"("orgId", "mode");

-- CreateTable: #4 one org's credential + capability record for ONE forge account. "credentialRef"
-- holds encryptSecret() CIPHERTEXT, never a plaintext token and never a pointer to one, so the
-- secret dies with the row and the org-erase in src/lib/db/retention.ts is a real destruction.
-- NULL there = registered but unauthenticated (an anonymous public-read adapter), a capability fact
-- rather than a missing credential. "capabilitiesJson" is TEXT, never jsonb (the DSQL/PGlite safety
-- contract). Organization."githubInstallId" is untouched and remains the GitHub read path.
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "forge" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "host" TEXT,
    "credentialRef" TEXT,
    "capabilitiesJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Installation_orgId_forge_externalId_key" ON "Installation"("orgId", "forge", "externalId");

-- CreateIndex
CREATE INDEX "Installation_orgId_idx" ON "Installation"("orgId");

-- Seed the shared "public" organization once. Every anonymous scan persists under this org, so
-- seeding it here (idempotently) lets the app resolve it with a plain read instead of upserting the
-- same hot row on every scan — which on Aurora DSQL (optimistic concurrency, no row locks) makes
-- concurrent scans collide on a retryable serialization conflict. See src/lib/db/scans.ts
-- (ensureOrgId) and docs/ARCHITECTURE.md §3. The id is a fixed sentinel UUID (the column is TEXT;
-- under relationMode="prisma" there are no DB-level FKs, so any stable value is fine).
INSERT INTO "Organization" ("id", "slug", "name", "plan", "kind")
VALUES ('00000000-0000-4000-8000-000000000001', 'public', 'Public Scans', 'free', 'public')
ON CONFLICT ("slug") DO NOTHING;
