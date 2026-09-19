-- App Readiness Passport overrides (P4): owner-set values for the fields a scan can't observe
-- (criticality / lifecycle / rollback), applied as a read-time overlay. Additive + nullable, JSON-as-TEXT.

-- AlterTable
ALTER TABLE "Repository" ADD COLUMN "passportOverridesJson" TEXT;
