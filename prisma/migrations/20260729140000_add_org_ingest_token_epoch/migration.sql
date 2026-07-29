-- AlterTable: per-org revocation epoch for the OTel ingest token. The token embeds the epoch it was
-- minted at; the ingest guard rejects any token below the stored value, so bumping this kills a
-- leaked token for ONE org without rotating the server-wide secret (which re-derives every org's
-- token at once). Existing tokens were minted before epochs existed, so the default backfills them
-- at 0 — the epoch-0 token format is unchanged and keeps working.
ALTER TABLE "Organization" ADD COLUMN "ingestTokenEpoch" INTEGER NOT NULL DEFAULT 0;
