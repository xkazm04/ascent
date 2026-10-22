-- OTLP POINT RECEIPTS (scan-sweep challenge 2026-10-22c, providers-0: "Replay-safe OTLP delta ingest").
--
-- One new table; nothing existing is altered or backfilled. The OTLP metrics ingest claims one row per
-- admitted datapoint and sink with INSERT ... ON CONFLICT DO NOTHING inside the sink write's
-- transaction, so a resent export (at-least-once delivery) is recognized instead of re-incremented.
-- Rows expire after a 7-day replay horizon, swept by the ingest itself. Standalone (no FK,
-- relationMode = "prisma"). Rollback: drop the table; stored usage is unaffected either way.
CREATE TABLE "OtlpPointReceipt" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sink" TEXT NOT NULL,
    "pointKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtlpPointReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the replay contract. A resent datapoint collides here, so its claim inserts nothing.
CREATE UNIQUE INDEX "OtlpPointReceipt_orgId_sink_pointKey_key" ON "OtlpPointReceipt"("orgId", "sink", "pointKey");

-- CreateIndex: the in-request expiry sweep (orgId, createdAt < horizon).
CREATE INDEX "OtlpPointReceipt_orgId_createdAt_idx" ON "OtlpPointReceipt"("orgId", "createdAt");
