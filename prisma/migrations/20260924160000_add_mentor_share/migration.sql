-- C3 CARE SHARE: the signed-in developer's own care loop (backlog develop-2026-09-17 row 46).
--
-- `POST /api/me/mentor/share` stores ONE snapshot per login (profile, moves, journal, session shape,
-- setup), and the Developer home reads it back for that login only. Keyed by the normalized GitHub
-- login the route resolved from the session; the payload itself never names the person.
--
-- A new table, additive; nothing existing is touched or backfilled. A push replaces the row and
-- `DELETE /api/me/mentor/share` removes it: no history, no soft delete.

-- CreateTable
CREATE TABLE "MentorShare" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "sharedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentorShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MentorShare_login_key" ON "MentorShare"("login");
