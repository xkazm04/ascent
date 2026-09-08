// The model scorecard's view model — four named axes and a decision, as a small multiple.
//
// The header used to name the axes in a sentence: "judged output quality, calibration against the
// labeled benchmark, reliability, and speed. Use it to pick the model to connect above." Four axes
// and a call to action is a chart and an affordance, not a paragraph.
//
// THE CONFLATION THIS FIXES. `ModelScore` has no nullable field: a model the harness never got a
// verdict out of still arrives carrying `quality: 0, within1: 0, mae: 0, reliability: 0`. The table
// already refused to PRINT those (isAdapterArtifact swaps the row for a label — the decode-adapter
// fix), but refusing to print is an UNMARKED absence: the reader could not tell "the harness
// truncated every attempt" from "we did not measure this one" from a genuinely bad model, because
// all three rendered as nothing in the score columns. Those cells are `not-judged` now — hatched,
// and `rendersValue("not-judged")` is false, so the cell STRUCTURALLY cannot print the zero the data
// is carrying. Note `mae: 0` in particular: fed to calibrationScore it yields a PERFECT 10 out of
// zero measurements, which is the exact shape of a number nobody should ever see.
//
// Pure: no React, no hooks, no data import. The kit types are `import type`.

import type { MatrixRow, VizState } from "@/components/org/viz";
import { calibrationScore, isAdapterArtifact, type MatrixScores, type ModelScore } from "@/lib/llm/matrix-scores";

/** Where SettingsTab anchors the OpenRouter BYOM card — the target of the scorecard's "Use ↑" links.
 *  Lives in this pure module so the server tab can read it without importing a client component. */
export const BYOM_ANCHOR = "byom-openrouter";

/** The three judged axes, ≤8 characters so MatrixGrid's 46-unit columns do not collide. Speed is
 *  deliberately NOT a column: it is a DURATION, and MatrixGrid paints a printed score on the red→green
 *  maturity ramp (scoreHex). Putting milliseconds on that ramp is the misreading Wave 2 caught in the
 *  practices rollout — so latency stays a printed duration in the ranked list, on its own units. */
export const SCORE_AXES = ["Quality", "Calib.", "Reliab."] as const;
export type ScoreAxis = (typeof SCORE_AXES)[number];

/** The (D) Disclosed destination for the demoted header lede — one sentence per axis. */
export const SCORE_AXIS_HINT: Record<ScoreAxis, string> = {
  Quality:
    "An LLM judge's overall rating (1–10, shown here out of 100) of the assessment the model wrote for the repo-maturity op — the only LLM call Ascent makes during a scan.",
  "Calib.":
    "How close the model lands to the labeled benchmark's own maturity level: 100 is exact agreement, and each whole level of mean error costs about 30 points. It is the guard against fluent output that is confidently at the wrong level.",
  "Reliab.":
    "The share of benchmark repositories where the model returned a usable assessment at all, rather than erroring or covering less than half the rubric. A hatched cell means the harness never got a verdict out of this model, so none of the three axes was judged — never read that as a zero.",
};

/** Row labels are drawn into MatrixGrid's 104-unit gutter at 10px mono-uppercase with 0.18em
 *  tracking — about 13 characters before they run into the first cell. The full slug stays in the
 *  ranked list below, where it is what an owner copies. */
export const MODEL_LABEL_MAX = 13;

/** "google/gemini-3.5-flash" → "gemini-3.5-flash". The vendor prefix is the same for a whole column. */
export function shortModel(slug: string): string {
  return slug.split("/").pop() ?? slug;
}

/** Fit a model name into the matrix gutter without inventing a name for it. */
export function matrixLabel(slug: string): string {
  const s = shortModel(slug);
  return s.length <= MODEL_LABEL_MAX ? s : `${s.slice(0, MODEL_LABEL_MAX - 1)}…`;
}

/** Median assess latency, on its own units. Sub-10s keeps a decimal; beyond that it is noise. */
export function latencyLabel(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

/**
 * One matrix row per model. An adapter-artifact row is `not-judged` across ALL THREE axes: the run
 * hit the output-token cap on every attempt, so there is no verdict on quality, none on calibration,
 * and its 0% reliability is the harness's reading rather than the model's.
 */
export function scorecardRow(m: ModelScore): MatrixRow {
  const label = matrixLabel(m.model);
  if (isAdapterArtifact(m)) {
    return { id: m.model, label, cells: [{ state: "not-judged" }, { state: "not-judged" }, { state: "not-judged" }] };
  }
  const measured = (score: number) => ({ state: "measured" as VizState, score });
  return {
    id: m.model,
    label,
    cells: [
      measured(Math.round(m.quality * 10)),
      measured(Math.round(calibrationScore(m) * 10)),
      measured(Math.round(m.reliability * 100)),
    ],
  };
}

/** Rows in the ranked order the list below uses, so the picture and the index agree line for line. */
export function scorecardRows(ranked: ModelScore[]): MatrixRow[] {
  return ranked.map(scorecardRow);
}

/** Only the states actually drawn — the `Legend` contract. */
export function scorecardStates(rows: MatrixRow[]): VizState[] {
  const present = new Set(rows.flatMap((r) => r.cells.map((c) => c.state)));
  return (["measured", "not-judged"] as VizState[]).filter((s) => present.has(s));
}

/** "10 labeled repos · measured 2026-07-07" — window and sample, not meaning (§2.3). */
export function scorecardScopeLine(scores: Pick<MatrixScores, "measuredAt" | "repos">): string {
  return `${scores.repos} labeled repos · measured ${scores.measuredAt.slice(0, 10)}`;
}
