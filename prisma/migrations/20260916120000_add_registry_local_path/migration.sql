-- THE REGISTRY'S LOCAL WORKING COPY (self-hosted pairing).
--
-- A self-hosted install usually has no GitHub App, and every registry read went through an App
-- installation token: mapping, re-indexing, the skill trace and the fleet conformance sweep were all
-- unavailable. The registry nearly always sits on the same disk as the app. Admin -> Pairing now pairs
-- it like a fleet repo, and this column is where that pairing lives.
--
-- Nullable with no backfill: every existing row reads through GitHub, which is exactly what NULL means.
ALTER TABLE "OrgRegistry" ADD COLUMN "localPath" TEXT;
