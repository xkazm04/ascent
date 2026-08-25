-- ATHENA: the resident, ORG-SCOPED companion — her threads, her turns, her open asks, her identity.
--
-- WHY these tables exist at all, given the org already has a memory store: her EPISODES do NOT get a
-- table. They are written into OrgMemory (namespace "athena", kind "episodic", source "athena"), because
-- an episode is exactly what that store already models and a second one would fork the org's memory.
--
-- Her IDENTITY is the part OrgMemory cannot hold:
--   • updateOrgMemory patches any id handed to it — a constitution there would be editable by anything;
--   • normalizeMemoryKind coerces an unknown kind to "semantic" — a "constitution" kind would vanish;
--   • selectDecayed ages and archives any kind outside DECAY_EXEMPT_KINDS — a constitution that can be
--     forgotten is not a constitution.
--
-- Additive only — no existing table or column is touched. JSON-in-TEXT columns (`metaJson`,
-- `payloadJson`) follow the schema's no-jsonb DSQL contract, and relationMode = "prisma" means no FK
-- and no ON DELETE is emitted: the delete graph is written by hand in eraseOrgAthena.

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
-- merged into "payloadJson" — an outcome is kind-shaped, so a dedicated column would either be a
-- second blob or a lowest-common-denominator string that loses the useful half.
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
