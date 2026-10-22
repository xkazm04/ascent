-- LOGIN DISCOVERY (scan-sweep challenge 2026-10-22c, oauth-1: "Production sign-in lands on an
-- onboarding that knows your installs and orgs").
--
-- One new table; nothing existing is altered or backfilled. The Supabase sign-in callback records the
-- org suggestions and seeded org its deferred discovery computed, keyed on the lowercased GitHub login,
-- overwritten per sign-in; /onboarding reads it back for the viewer's own login only. Org names only,
-- no token or secret. Standalone (no FK, relationMode = "prisma"). Rollback: drop the table.
CREATE TABLE "LoginDiscovery" (
    "login" TEXT NOT NULL,
    "suggestedOrgsJson" TEXT NOT NULL DEFAULT '[]',
    "seededOrg" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginDiscovery_pkey" PRIMARY KEY ("login")
);
