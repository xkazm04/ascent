-- AlterTable: `.ai/` standard conformance reported back by the repo's doctor (null = never reported).
ALTER TABLE "Repository" ADD COLUMN     "aiConformance" INTEGER,
ADD COLUMN     "aiConformanceFails" INTEGER,
ADD COLUMN     "aiConformanceWarns" INTEGER,
ADD COLUMN     "aiConformanceAt" TIMESTAMP(3);
