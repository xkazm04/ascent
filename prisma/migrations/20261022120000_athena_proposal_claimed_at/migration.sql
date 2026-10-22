-- ATHENA PROPOSAL CLAIM TIME (scan-sweep challenge 2026-10-22, "The proposal gate as a written state
-- machine with a reaper").
--
-- One additive, nullable column; no data is rewritten. Every existing row reads NULL, which the
-- lifecycle (src/lib/athena/proposal-lifecycle.ts) treats as "no claim age known": an existing
-- accepted-but-unstamped row is a stale claim the sweep stamps 'interrupted', and every other row is
-- unaffected. The new stored status value 'expired' needs no DDL ("status" is TEXT).
ALTER TABLE "AthenaProposal" ADD COLUMN "claimedAt" TIMESTAMP(3);
