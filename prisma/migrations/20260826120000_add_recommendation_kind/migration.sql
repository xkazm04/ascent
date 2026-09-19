-- RECOMMENDATION KIND (rubric r10): `gap` is a shortfall below the band — a follow-up the loop may
-- work; `craft` is what would make an already-strong dimension exemplary, shown on the report and
-- never a follow-up, never debt, never a loop batch, never auto-closed. Additive with a default, so
-- every existing row is a `gap` and nothing downstream changes for pre-r10 scans.
ALTER TABLE "Recommendation" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'gap';
