// Bake bench/matrix/records.json into src/lib/llm/matrix-scores.data.ts — the generated data the org
// settings scorecard reads (via the pure helpers in src/lib/llm/matrix-scores.ts). Aggregates each
// model across the bench repos: judged quality (+ dims), calibration (exact/within-1/MAE), reliability,
// median latency, mean output tokens. GENERATED — re-bake after a run, don't hand-edit.
//
//   npx vite-node --config vitest.config.js scripts/matrix/bake.mts

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MatrixScores, ModelScore } from "@/lib/llm/matrix-scores";

interface Rec {
  repo: string; model: string; expected: string; predicted: string | null;
  levelDelta: number | null; usable: boolean; error: string | null;
  latencyMs: number; outputTokens: number;
  judge: { score: number; relevance: number; correctness: number; adherence: number } | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function main(): void {
  const records = JSON.parse(readFileSync(resolve("bench/matrix/records.json"), "utf8")) as Rec[];
  const byModel = new Map<string, Rec[]>();
  const order: string[] = [];
  for (const r of records) {
    if (!byModel.has(r.model)) { byModel.set(r.model, []); order.push(r.model); }
    byModel.get(r.model)!.push(r);
  }
  const repos = new Set(records.map((r) => r.repo)).size;

  const models: ModelScore[] = order.map((model) => {
    const rs = byModel.get(model)!;
    const judged = rs.filter((r) => r.judge);
    // Calibration counts USABLE predictions only: an unusable assessment (0 dims) still yields a level
    // via assembleReport's deterministic-signal fallback, which would otherwise credit the model for the
    // deterministic baseline it didn't produce. Reliability captures the failures separately.
    const scored = rs.filter((r) => r.usable && r.predicted !== null);
    const exact = scored.filter((r) => r.levelDelta === 0).length;
    const within1 = scored.filter((r) => (r.levelDelta ?? 9) <= 1).length;
    return {
      model,
      quality: r1(mean(judged.map((r) => r.judge!.score))),
      relevance: r1(mean(judged.map((r) => r.judge!.relevance))),
      correctness: r1(mean(judged.map((r) => r.judge!.correctness))),
      adherence: r1(mean(judged.map((r) => r.judge!.adherence))),
      exact: r3(scored.length ? exact / scored.length : 0),
      within1: r3(scored.length ? within1 / scored.length : 0),
      mae: r1(mean(scored.map((r) => r.levelDelta ?? 0))),
      reliability: r3(rs.length ? rs.filter((r) => r.usable).length / rs.length : 0),
      p50Ms: Math.round(median(rs.filter((r) => !r.error).map((r) => r.latencyMs))),
      outTok: Math.round(mean(rs.filter((r) => !r.error).map((r) => r.outputTokens))),
      n: rs.length,
    };
  });

  // measuredAt: the newest fixture/run isn't stamped in records; use the file mtime substitute — the
  // bake time. (vite-node runs in Node, so Date is available here, unlike the workflow sandbox.)
  const payload: MatrixScores = {
    measuredAt: new Date().toISOString(),
    judge: process.env.MATRIX_JUDGE_MODEL || "anthropic/claude-sonnet-5",
    repos,
    models,
  };
  const ts =
    "// Measured model-quality scores for the repo-maturity assess op — output of the Python-free bench\n" +
    "// matrix (scripts/matrix/run.mts), judged by an LLM, baked by scripts/matrix/bake.mts. GENERATED —\n" +
    "// re-bake, don't hand-edit. See docs/LLM_MODEL_MATRIX.md.\n" +
    `// Baked from a run at ${payload.measuredAt}.\n` +
    'import type { MatrixScores } from "@/lib/llm/matrix-scores";\n\n' +
    `export const MATRIX_SCORES: MatrixScores = ${JSON.stringify(payload, null, 2)};\n\n` +
    "/** True once a matrix run has been baked in (so the UI can hide the scorecard before any run). */\n" +
    "export function hasMatrixScores(): boolean {\n" +
    "  return MATRIX_SCORES.models.length > 0;\n" +
    "}\n";
  const out = resolve("src/lib/llm/matrix-scores.data.ts");
  writeFileSync(out, ts, "utf8");
  console.log(`wrote ${out} (${models.length} models, ${repos} repos)`);
}

main();
