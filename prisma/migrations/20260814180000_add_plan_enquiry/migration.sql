-- Custom-plan enquiries from the /pricing card's form.
--
-- The bespoke tier (stored id `enterprise`, shown as "Custom") has no checkout — its price is
-- negotiated — so this row IS the lead and the operator mail is only a notification about it. That
-- ordering is why the table exists at all: the route persists first and mails second, so a provider
-- outage or a bounced operator inbox can never discard a prospect whose message has already left
-- their browser. `emailStatus` records what happened to the notification WITHOUT the enquiry
-- depending on it, which makes "we have the lead but nobody was told" a visible state.
--
-- Standalone under relationMode = "prisma" (no FKs) — a prospect has no Organization yet by
-- definition, which is the whole reason they are writing in.
CREATE TABLE "PlanEnquiry" (
    "id" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'enterprise',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "fleetSize" TEXT NOT NULL DEFAULT '',
    "areasJson" TEXT NOT NULL DEFAULT '[]',
    "message" TEXT NOT NULL,
    "viewerLogin" TEXT,
    "orgSlug" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanEnquiry_pkey" PRIMARY KEY ("id")
);

-- The only read this table has is "newest enquiries first".
CREATE INDEX "PlanEnquiry_createdAt_idx" ON "PlanEnquiry"("createdAt");
