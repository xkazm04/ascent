-- DECLARED SEGMENT MEMBERSHIP (scan-sweep challenge 2026-10-05, "Segments keep a rule, not a snapshot").
--
-- Two additive columns. Both are inert on their own, which is the rollback story: every existing
-- RepoSegment row keeps meaning exactly what it means today ("a human put this here"), and a segment
-- with no ruleJson behaves as it always has.
--
-- Segment.ruleJson  - the segment's DECLARED membership as JSON { kind, values }; NULL = a hand-kept
--                     list, which is what every row is before this migration.
-- RepoSegment.source - who wrote the membership row. Defaulted to 'manual' and backfilled by the
--                     DEFAULT on existing rows, so a rule convergence (which may only reap rows it
--                     OWNS) can never delete a tag that predates this feature.
ALTER TABLE "Segment" ADD COLUMN "ruleJson" TEXT;
ALTER TABLE "RepoSegment" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
