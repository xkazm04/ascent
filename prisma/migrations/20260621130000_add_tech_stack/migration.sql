-- Tech-stack extraction (Feature 3a): persist the detected stack per scan (history) and cache the
-- latest on the repo (fleet-wide grouping without re-deriving). Both additive + nullable, JSON-as-TEXT.

-- AlterTable
ALTER TABLE "Repository" ADD COLUMN "techStackJson" TEXT;

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN "techStackJson" TEXT;
