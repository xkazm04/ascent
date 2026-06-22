-- App Readiness Passport (P1): persist the passport per scan (history) and cache the latest on the repo
-- (portfolio comparison without re-deriving). Both additive + nullable, JSON-as-TEXT, display-only.

-- AlterTable
ALTER TABLE "Repository" ADD COLUMN "passportJson" TEXT;

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN "passportJson" TEXT;
