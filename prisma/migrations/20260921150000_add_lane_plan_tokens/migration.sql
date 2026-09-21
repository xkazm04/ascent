-- THE PLANNING SESSION'S OWN TOKENS (spark local-model-lanes, WP9, 2026-09-21).
--
-- A lane runs up to TWO agent sessions: one that plans and one that executes. The token columns this
-- table already has (`inputTokens`, `outputTokens`, `cacheReadTokens`, `turns`, `agentDurationMs`)
-- record the EXECUTING session and keep that meaning byte-for-byte — nothing below repurposes them.
--
-- WHY THE ROW AND NOT A JOIN. The optimized metric of this feature is CLAUDE TOKENS PER VERIFIED
-- POINT, computed per lane. A split arm — Claude plans, a local model executes — spends its Claude
-- tokens in the planning session and its local tokens in the executing one, so a row carrying only
-- the executing half reported the split arm as costing ZERO Claude tokens: wrong, and flattering to
-- the very arm the feature advocates. The two halves also reach the usage ledger as separate
-- `UsageEvent` rows, and those stay exactly as they are; this is not a replacement for them but the
-- row learning what it spent, because a metric that must join a ledger to answer its own question is
-- one refactor away from silently answering zero.
--
-- EVERY COLUMN IS NULLABLE, with no DEFAULT and no backfill. A lane written before them has an
-- UNKNOWN planning cost; a 0 in its place would be averaged downstream as a free planning session.
-- A lane that never planned at all records NULL for the same reason — absence, not zero.

ALTER TABLE "LoopRunLane" ADD COLUMN "planInputTokens" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN "planOutputTokens" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN "planCacheReadTokens" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN "planTurns" INTEGER;
ALTER TABLE "LoopRunLane" ADD COLUMN "planDurationMs" INTEGER;
