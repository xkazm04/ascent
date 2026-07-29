-- G3-01 — cross-instance dedup for SHA-LESS scans.
--
-- WHY: `Scan_repoId_headSha_key` is the cross-instance backstop that makes a same-commit race lose with
-- P2002 instead of inserting a second metered row. Postgres treats NULLs as DISTINCT, so that constraint
-- never engages when `headSha` is NULL — and a sha-less report (head resolution failed, a reconstructed
-- snapshot) is exactly the case where the read-then-insert dedup is weakest. Two serverless instances
-- persisting the same computed report both read "nothing there yet" and both inserted. `dedupKey` is the
-- persisted, indexed idempotency key that closes it: it carries the report's own identity (scannedAt +
-- the content key — score/level/axes/engine + per-dimension scores; see scanDedupKey in
-- src/lib/db/scans-read.ts), so the same computed report can exist at most once per repo.
--
-- EXISTING ROWS: the column is NULLABLE with no default and is NOT backfilled, so every existing Scan
-- row gets NULL. Because NULLs are distinct under a UNIQUE index, no existing row can collide with
-- another — this migration cannot fail on a populated database and changes no existing row's behavior.
-- Legacy sha-less rows simply stay outside the new constraint and keep deduping through the
-- read-then-decide path (findScanByScannedAt + content key); newly written sha-less rows are protected.
-- Rows WITH a headSha deliberately keep `dedupKey` NULL forever — one dedup identity per row.
ALTER TABLE "Scan" ADD COLUMN "dedupKey" TEXT;

-- CreateIndex
-- ON AURORA DSQL: run this as `CREATE UNIQUE INDEX ASYNC "Scan_repoId_dedupKey_key" ON "Scan"("repoId", "dedupKey");`
-- out of band (DSQL builds secondary indexes asynchronously and rejects the synchronous form on a
-- populated table), wait for it to report ACTIVE, then mark this migration applied with
-- `prisma migrate resolve --applied 20260729120000_add_scan_dedup_key`. See docs/ARCHITECTURE.md §3.
CREATE UNIQUE INDEX "Scan_repoId_dedupKey_key" ON "Scan"("repoId", "dedupKey");
