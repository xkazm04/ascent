-- LOOP DRIVE — the sequence of loop runs that pulls a fleet toward green, made durable.
--
-- The runs a drive dispatches were always LoopRun rows; the drive's own intent lived only in a Map on
-- globalThis, so a server restart mid-drive ended it silently and a later status read reported
-- nothing at all. This table gives the drive the same durability its runs have, plus the two fields
-- resuming needs: `runsBefore` (runs already spent by the chain, so the cap counts the chain and not
-- the segment) and `resumedFrom`. A row left `running` by a dead process is reconciled to
-- `interrupted` by the boot sweep — never auto-resumed.
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
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "LoopDrive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoopDrive_orgId_startedAt_idx" ON "LoopDrive"("orgId", "startedAt");
