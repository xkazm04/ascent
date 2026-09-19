// Ingestion volume is part of score calibration. Every source adapter uses the same
// limits so changing a forge does not silently change how much evidence a scan reads.
export const MAX_FILE_BYTES = 14_000;
// CODEOWNERS is parsed for exact ownership; the ordinary prompt cap loses later teams.
export const MAX_CODEOWNERS_BYTES = 60_000;
export const MAX_TOTAL_BYTES = 280_000;
export const COMMIT_COUNT = 30;
