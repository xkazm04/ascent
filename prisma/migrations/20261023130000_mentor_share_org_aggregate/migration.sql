-- C4 CONSENT (scan-sweep challenge 2026-10-22d, developer-0: "one consent-keyed producer feeds the
-- org care aggregate and your bands").
--
-- One additive column; no existing row changes meaning. The default is FALSE, so every share stored
-- before consent existed stays OUT of the anonymous org aggregate until its owner pushes a share with
-- consent.orgAggregate = true. saveMentorShare mirrors the validated payload flag into this column on
-- every save, so the cohort read filters on it. Rollback: drop the column.
ALTER TABLE "MentorShare" ADD COLUMN "orgAggregate" BOOLEAN NOT NULL DEFAULT false;
