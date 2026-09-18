-- THE STANDING RUNNER + THE THEATER (spark theater-upgrade, 2026-09-18).
--
-- The Live tab's loop becomes a runner that can be left alone: a `continuous` drive that never stops
-- on green, dry or a run cap (it PAUSES, on named breakers), whose lanes plan before they edit, and
-- whose only human gate is a plan that moves architecture. Three views read it: a passive theater, a
-- ledger for the returning operator, and the cockpit.
--
-- Every added column is NULLABLE or DEFAULTED, and every default reproduces the behaviour of the rows
-- that already exist: `LoopDrive.mode` defaults to 'bounded' (exactly what every drive was),
-- `LoopRun.planMode` null means OFF (no planning session), and a lane's new telemetry columns are
-- null on every lane written before them — "not recorded", which each reader treats as such.

-- The ledger's "since you last looked" anchor, per member per org (the `alertsSeenAt` pattern).
ALTER TABLE "Membership" ADD COLUMN "liveSeenAt" TIMESTAMP(3);

-- A run's stable number within its org, the drive that dispatched it, and whether its lanes plan.
ALTER TABLE "LoopRun" ADD COLUMN "seq" INTEGER;
ALTER TABLE "LoopRun" ADD COLUMN "driveId" TEXT;
ALTER TABLE "LoopRun" ADD COLUMN "planMode" TEXT;

-- What a running lane is doing, for a screen nobody is operating.
ALTER TABLE "LoopRunLane" ADD COLUMN "planId" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
ALTER TABLE "LoopRunLane" ADD COLUMN "stageAt" TIMESTAMP(3);
ALTER TABLE "LoopRunLane" ADD COLUMN "deadlineAt" TIMESTAMP(3);
ALTER TABLE "LoopRunLane" ADD COLUMN "activityJson" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN "proposedJson" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN "diffStatJson" TEXT;
ALTER TABLE "LoopRunLane" ADD COLUMN "landedAt" TIMESTAMP(3);

-- A drive that can be continuous, pause on a breaker, and carry every run dial.
ALTER TABLE "LoopDrive" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'bounded';
ALTER TABLE "LoopDrive" ADD COLUMN "pausedReason" TEXT;
ALTER TABLE "LoopDrive" ADD COLUMN "pausedUntil" TIMESTAMP(3);
ALTER TABLE "LoopDrive" ADD COLUMN "spendCeilingMicros" INTEGER;
ALTER TABLE "LoopDrive" ADD COLUMN "repoStateJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "LoopDrive" ADD COLUMN "dialsJson" TEXT;
ALTER TABLE "LoopDrive" ADD COLUMN "lastBeatAt" TIMESTAMP(3);

-- Every lane's plan — the persisted proposals ledger. See schema.prisma for the vocabularies.
CREATE TABLE "LoopPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "runId" TEXT,
    "laneId" TEXT,
    "directionId" TEXT,
    "itemKeysJson" TEXT NOT NULL DEFAULT '[]',
    "recIdsJson" TEXT NOT NULL DEFAULT '[]',
    "planJson" TEXT NOT NULL DEFAULT '{}',
    "planText" TEXT NOT NULL DEFAULT '',
    "partitionJson" TEXT,
    "cls" TEXT NOT NULL DEFAULT 'minor',
    "clsReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'executing',
    "sessionId" TEXT,
    "heldBranch" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoopPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoopPlan_orgId_status_idx" ON "LoopPlan"("orgId", "status");
CREATE INDEX "LoopPlan_orgId_repo_idx" ON "LoopPlan"("orgId", "repo");

-- An approved, fenced, budgeted direction.
CREATE TABLE "LoopDirection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fenceJson" TEXT NOT NULL DEFAULT '[]',
    "checkText" TEXT NOT NULL DEFAULT '',
    "budgetCycles" INTEGER NOT NULL DEFAULT 3,
    "budgetMicros" INTEGER,
    "usedCycles" INTEGER NOT NULL DEFAULT 0,
    "usedMicros" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "originPlanId" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LoopDirection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoopDirection_orgId_status_idx" ON "LoopDirection"("orgId", "status");

-- Backfill `seq`: number every existing run within its org in creation order, so the first run the
-- ledger shows after this migration is not "#1" of a history that already had forty.
UPDATE "LoopRun" AS r
SET "seq" = n."rn"
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "orgId" ORDER BY "createdAt", "id") AS "rn" FROM "LoopRun") AS n
WHERE r."id" = n."id";
