-- Context Health (W4) — additive JSON-in-TEXT columns (the schema's no-jsonb DSQL-safety contract,
-- exactly like techStackJson/passportJson). Per-scan history on Scan; the latest cached on Repository
-- so the fleet rollup reads it without joining the scan graph. Display-only: never feeds the score.
ALTER TABLE "Scan" ADD COLUMN "contextHealthJson" TEXT;
ALTER TABLE "Repository" ADD COLUMN "contextHealthJson" TEXT;
