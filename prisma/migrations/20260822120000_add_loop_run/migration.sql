-- LOCAL-MODE LOOP RUNS: the durable spine under the war room's autopilot.
--
-- The autopilot kept one org's single-repo job in a process Map, so a restart erased the run's phase,
-- branch and log while its real output (commits, scans, closed rows) survived. These two tables make
-- the run itself durable and widen it to a SELECTED SET of repos worked in bounded-parallel LANES.
--
-- Additive only — no existing table or column is touched. JSON-in-TEXT columns follow the schema's
-- no-jsonb DSQL contract.

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
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoopRun_pkey" PRIMARY KEY ("id")
);

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

    CONSTRAINT "LoopRunLane_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoopRunLane_runId_idx" ON "LoopRunLane"("runId");
