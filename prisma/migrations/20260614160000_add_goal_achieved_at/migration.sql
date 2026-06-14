-- AlterTable: when a goal first reaches its target, listGoals stamps achievedAt (and flips status to
-- "achieved") once. Nullable/additive — existing goals are unaffected until they next meet their target.
ALTER TABLE "Goal" ADD COLUMN     "achievedAt" TIMESTAMP(3);
