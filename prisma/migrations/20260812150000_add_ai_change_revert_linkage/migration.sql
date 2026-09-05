-- W5 revert linkage: stamp an AI-attributed change with the merged revert PR that rolled it back
-- (matched within the scanned PR window — a lower bound, disclosed on the fields). Additive + nullable,
-- so existing rows read as "no revert matched", never as data loss.
ALTER TABLE "AiChange" ADD COLUMN "revertedByPr" INTEGER;
ALTER TABLE "AiChange" ADD COLUMN "revertedAt" TIMESTAMP(3);
