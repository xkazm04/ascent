-- MC-B8a: the single concrete first move, rendered above the rationale. "" = not recorded
-- (pre-field scans and models that omit it); never backfilled — fabricating a first step for an
-- old row would be a claim the scan never made.
ALTER TABLE "Recommendation" ADD COLUMN "firstStep" TEXT NOT NULL DEFAULT '';
