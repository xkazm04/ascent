-- CreateTable: best-effort public-badge reach tally — one row per (repo, embedding host), counted up
-- on each origin badge GET. Powers the "Badge reach" panel on /usage. Approximate by design: README
-- badges are heavily proxy/CDN-cached, so most real views never reach the origin (lower-bound reach).
CREATE TABLE "BadgeImpression" (
    "id" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "refererHost" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeImpression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BadgeImpression_repoFullName_refererHost_key" ON "BadgeImpression"("repoFullName", "refererHost");

CREATE INDEX "BadgeImpression_repoFullName_idx" ON "BadgeImpression"("repoFullName");
