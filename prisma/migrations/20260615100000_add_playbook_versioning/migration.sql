-- AlterTable: playbooks gain a version (bumped on each content edit) + updatedAt; an application
-- records which version a repo adopted. version/updatedAt backfill existing rows (v1, now);
-- appliedVersion is nullable (pre-versioning adoption marks stay null).
ALTER TABLE "Playbook" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PlaybookApplication" ADD COLUMN     "appliedVersion" INTEGER;
