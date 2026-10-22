-- CATCH-UP: THE 56 COLUMNS AND 4 INDEXES THE CHAIN NEVER ADDED.
--
-- These reached prisma/schema.prisma and prisma/init.sql on tables the chain does create, with no
-- migration, so a database built by `prisma migrate deploy` lacked them and the first query naming
-- one failed. Every column here is nullable or carries a DEFAULT, so it applies to a populated table
-- without a backfill. Every statement is IF NOT EXISTS: on a database that already has them (db push,
-- init.sql) the step is a no-op.
--
-- Additive only, pinned by src/lib/db/migration-chain.test.ts: no DROP, DELETE, UPDATE, TRUNCATE,
-- SET DEFAULT, ADD CONSTRAINT or ALTER ... TYPE. The definitions are lifted from prisma/init.sql.

ALTER TABLE "AiChange" ADD COLUMN IF NOT EXISTS "approvalObservedAt" TIMESTAMP(3);
ALTER TABLE "AiChange" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'scan';
ALTER TABLE "ImprovementPr" ADD COLUMN IF NOT EXISTS "loopLaneId" TEXT;
ALTER TABLE "ImprovementPr" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'practice';
ALTER TABLE "LoopDrive" ADD COLUMN IF NOT EXISTS "delivery" TEXT;
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "agentTimeoutMs" INTEGER;
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "batchSize" INTEGER;
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "delivery" TEXT;
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "modelPolicy" TEXT NOT NULL DEFAULT 'single';
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "modelsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "verifyMode" TEXT;
ALTER TABLE "LoopRun" ADD COLUMN IF NOT EXISTS "verifyTimeoutMs" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "abPairKey" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "agentDurationMs" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "agentSessionId" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "briefJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "cacheReadTokens" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "claimedBy" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "costMicros" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "costSource" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "deliverablesJson" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "dimId" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "executor" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "inputTokens" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3);
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "outputTokens" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "prNumber" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "prUrl" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "reportJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "turns" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "verifyCommand" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "verifyNote" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN IF NOT EXISTS "verifyVerdict" TEXT;
ALTER TABLE "OrgMemory" ADD COLUMN IF NOT EXISTS "citedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrgMemory" ADD COLUMN IF NOT EXISTS "notUsefulCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrgRegistry" ADD COLUMN IF NOT EXISTS "signalContributors" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrgRegistry" ADD COLUMN IF NOT EXISTS "signalsContributor" TEXT;
ALTER TABLE "OrgRegistry" ADD COLUMN IF NOT EXISTS "subjectCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrgSkillEvent" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
ALTER TABLE "OrgSkillEvent" ADD COLUMN IF NOT EXISTS "detail" TEXT;
ALTER TABLE "OrgSkillEvent" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "repoMemoryMirror" BOOLEAN;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "retentionCompact" BOOLEAN;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "retentionDigestMonths" INTEGER;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "claimActor" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "claimExecutor" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "craftAxis" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3);
ALTER TABLE "Recommendation" ADD COLUMN IF NOT EXISTS "needsHuman" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "forge" TEXT NOT NULL DEFAULT 'github';
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "guidanceGraphJson" TEXT;
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "manifestJson" TEXT;
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "guidanceGraphJson" TEXT;
ALTER TABLE "Scan" ADD COLUMN IF NOT EXISTS "manifestJson" TEXT;
CREATE INDEX IF NOT EXISTS "ImprovementPr_orgId_loopLaneId_idx" ON "ImprovementPr"("orgId", "loopLaneId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrgSkillEvent_skillId_dedupeKey_key" ON "OrgSkillEvent"("skillId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "Recommendation_status_leaseUntil_idx" ON "Recommendation"("status", "leaseUntil");
CREATE INDEX IF NOT EXISTS "Repository_orgId_forge_idx" ON "Repository"("orgId", "forge");
