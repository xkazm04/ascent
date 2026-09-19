-- Per-session coding-agent ATTEMPTS (W3a). AiUsageRecord answers "what did this repo cost on this
-- day"; it cannot answer "what does a unit of work cost", because a day bucket has no notion of an
-- attempt. This table is the attempt.
--
-- Only what the agent itself reports is stored (Claude Code's per-session OTel counters). No PR
-- linkage: the telemetry carries no PR number, so the join to merged changes is made at repo × period
-- level where both sides are counted rather than guessed.
--
-- No backfill — sessions exist from the first export after this migration. Historical AiUsageRecord
-- day-buckets are untouched and keep serving every existing view.
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
