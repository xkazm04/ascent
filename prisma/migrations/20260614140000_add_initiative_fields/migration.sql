-- AlterTable: initiatives gain ownership (assigneeLogin), a due date (targetDate), and an optional
-- link to the steering Goal they serve (goalId). All nullable/additive — existing rows unaffected.
ALTER TABLE "Initiative" ADD COLUMN     "assigneeLogin" TEXT,
ADD COLUMN     "targetDate" TIMESTAMP(3),
ADD COLUMN     "goalId" TEXT;
