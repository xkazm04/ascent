-- AlterTable: an initiative can track the rollout of a Playbook (the bridge from the authored
-- playbook to a tracked program of work). Nullable/additive — existing initiatives are unaffected.
ALTER TABLE "Initiative" ADD COLUMN     "playbookId" TEXT;
