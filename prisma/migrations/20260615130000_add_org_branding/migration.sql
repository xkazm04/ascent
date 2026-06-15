-- AlterTable: white-label branding for the executive briefing (EXEC-5) — brand name, accent colour,
-- and an https logo rendered in the briefing PDF. All nullable/additive (null = the Ascent default).
ALTER TABLE "Organization" ADD COLUMN     "brandName" TEXT,
ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "logoUrl" TEXT;
