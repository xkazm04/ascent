-- The org's named, dated TRANSITION PROGRAMME (W1c) — the state that outlives onboarding.
--
-- One row per org (orgId UNIQUE): a programme is the org's current commitment, not a backlog of
-- them. `baselineJson` is frozen at creation and never rewritten — a baseline recomputed from
-- today's data moves with the thing it is meant to measure, which is the whole failure this column
-- exists to prevent (Port's "baseline before you turn anything on"). NULL when the org had no
-- scanned repo at creation: an honest absent origin rather than a zeroed one.
--
-- No backfill. Existing orgs have no programme until someone starts one; the header strip simply
-- doesn't render, exactly as it does today.
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
