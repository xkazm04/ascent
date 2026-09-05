-- Membership onboarding stamp (W6a). The getting-started gate is a STAMP, not an empty-data
-- heuristic: either timestamp, once set, silences the guided onboarding flow for that member in
-- that org forever. Self-scoped like alertsSeenAt (written only on the caller's own row).
ALTER TABLE "Membership" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
ALTER TABLE "Membership" ADD COLUMN "onboardingSkippedAt" TIMESTAMP(3);

-- Backfill: every EXISTING membership is stamped completed as of migration time, so no live org
-- (or long-lived dev DB) gets ambushed by an onboarding flow for a workspace it has used for
-- months — the ascent equivalent of kp's seeded-self-stamp. Only memberships created AFTER this
-- migration start null and see the flow (which is why `npm run dev:empty` — fresh PGlite, fresh
-- memberships — fires it naturally).
UPDATE "Membership" SET "onboardingCompletedAt" = CURRENT_TIMESTAMP;
