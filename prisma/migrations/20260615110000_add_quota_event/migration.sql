-- CreateTable: public-funnel abuse counters (QUOTA-6) — a running tally per (kind, scope) bumped when
-- a weekly-quota denial or rate-limit trip fires. Surfaced on the public /usage view.
CREATE TABLE "QuotaEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuotaEvent_kind_scope_key" ON "QuotaEvent"("kind", "scope");
