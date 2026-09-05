-- AlterColumn: Organization.gatePolicy JSONB -> TEXT (serialized JSON), restoring the schema's
-- no-jsonb DSQL-safety contract — every other JSON payload is stored as serialized JSON in a TEXT
-- column. Existing jsonb values cast to their canonical JSON text, which org-gate.ts JSON.parses on read.
ALTER TABLE "Organization" ALTER COLUMN "gatePolicy" TYPE TEXT USING "gatePolicy"::text;
