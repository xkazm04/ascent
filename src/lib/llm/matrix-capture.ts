// Model-matrix input capture (dev/bench only). When ASCENT_MATRIX_CAPTURE_DIR is set, each scan writes
// its fully-built {scoreInput, snapshot} to a per-repo fixture so the model-comparison bench
// (scripts/matrix/run.mts) can REPLAY assess() across many models on IDENTICAL inputs — no re-fetch, no
// GitHub rate-limit churn, deterministic comparison. This is the assess op's analog of a seed corpus:
// the model-independent input is captured once, then every model is scored on the same repos.
//
// OFF by default (no capture, no overhead). Fixtures are RAW (unredacted) because a faithful replay
// needs the exact prompt inputs — write them only to a local dir you don't publish. Local/self-host
// only; on an ephemeral serverless FS the files won't persist.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RepoSnapshot } from "@/lib/types";
import type { LlmScoreInput } from "@/lib/llm/provider";

export interface MatrixFixture {
  /** "owner/repo" — the join key to bench/repos.json's ground-truth level. */
  repo: string;
  /** The scan's `now` (so a replayed assembleReport stamps the same timestamp). */
  at: string;
  /** Everything assess() needs — replayed verbatim across models. */
  scoreInput: LlmScoreInput;
  /** Everything assembleReport() needs beyond the assessment (coverage, files, meta). */
  snapshot: RepoSnapshot;
}

export function matrixCaptureEnabled(): boolean {
  return Boolean(process.env.ASCENT_MATRIX_CAPTURE_DIR);
}

/** Write one repo's replay fixture when ASCENT_MATRIX_CAPTURE_DIR is set. Never throws — a capture
 *  sink failure must not disturb a scan. Returns the file path written, or null when off/failed. */
export function captureMatrixInput(fx: MatrixFixture): string | null {
  const dir = process.env.ASCENT_MATRIX_CAPTURE_DIR;
  if (!dir) return null;
  try {
    mkdirSync(dir, { recursive: true });
    const safe = fx.repo.replace(/[^a-z0-9]+/gi, "__");
    const path = resolve(dir, `${safe}.json`);
    writeFileSync(path, JSON.stringify(fx), "utf8");
    return path;
  } catch {
    return null;
  }
}
