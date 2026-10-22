-- ORG LOGO SNAPSHOT (scan-sweep challenge 2026-10-22e, branding-0: "The logo is a validated asset
-- snapshotted at save, not a URL fetched per render").
--
-- One new table; nothing existing is altered or backfilled. The branding save stores the pinned,
-- format-sniffed logo here and the deliverables render it, so a render makes no call to the owner's
-- host. A cache keyed by orgId + sourceUrl: an org saved before this table existed has no row and heals
-- once on its next render. Standalone (no FK, relationMode = "prisma"). Rollback: drop the table;
-- Organization.logoUrl is untouched.
CREATE TABLE "OrgLogoSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dataUri" TEXT,
    "sha256" TEXT,
    "mime" TEXT,
    "reason" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgLogoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one snapshot per org (the read and the upsert key).
CREATE UNIQUE INDEX "OrgLogoSnapshot_orgId_key" ON "OrgLogoSnapshot"("orgId");
