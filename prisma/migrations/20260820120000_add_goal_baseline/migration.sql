-- The goal meter's missing half: the metric's value when the goal was CREATED.
-- Without it `pct` could only be current/target (attainment), so a new goal rendered a nearly-full
-- progress bar before anyone did any work. The value cannot be reconstructed afterwards, so it has
-- to be captured at creation.
--
-- Additive and nullable, with NO backfill on purpose: an invented baseline (e.g. the earliest scan
-- on record) would make an in-flight goal read as regressed and would look exactly like a measured
-- one. NULL is the honest state for every pre-existing goal, and listGoals renders those as
-- attainment explicitly labelled as attainment.
ALTER TABLE IF EXISTS "Goal" ADD COLUMN IF NOT EXISTS "baselineValue" INTEGER;
ALTER TABLE IF EXISTS "Goal" ADD COLUMN IF NOT EXISTS "baselineAt" TIMESTAMP(3);
