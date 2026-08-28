-- SCAN PROVENANCE — which engine produced a score, and what moved it.
--
-- Two facts the scan pipeline already computed and then dropped on the floor at persist time:
--
--   `engineDegraded` — an LLM was requested and every real attempt failed, so the row's
--   `engineProvider` is the deterministic mock FLOOR rather than a chosen engine. `engineProvider =
--   'mock'` alone cannot say this: it is also what a keyless deploy and an explicit demo look like,
--   and neither of those is a failure. Without the distinction a "lift" measured across a mock/real
--   boundary reads exactly like a repository improvement.
--
--   `scoreIntegrityJson` — the ScoreIntegrity record (d9Unmeasurable, widenedDims, widenCapped,
--   effectiveBlend): the three levers that can move a headline on an UNCHANGED commit. It was
--   computed, typed and rendered by nothing, and never reached the database, so a reconstructed
--   report and every run-over-run comparison had no way to attribute a delta to them.
--
-- Both nullable and additive: existing rows are UNKNOWN, which is deliberately not the same value as
-- "not degraded" / "nothing widened".
ALTER TABLE "Scan" ADD COLUMN "engineDegraded" BOOLEAN;
ALTER TABLE "Scan" ADD COLUMN "scoreIntegrityJson" TEXT;
