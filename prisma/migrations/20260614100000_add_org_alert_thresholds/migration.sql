-- AlterTable: per-org regression sensitivity overrides (null = inherit DEFAULT_THRESHOLDS).
ALTER TABLE "Organization" ADD COLUMN     "alertOverallDrop" INTEGER,
ADD COLUMN     "alertDimensionDrop" INTEGER;
