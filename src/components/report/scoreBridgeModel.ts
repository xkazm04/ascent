// The since-last-scan bridge: the headline DELTA, attributed to the dimensions that produced it.
//
// The waterfall already explains where the score IS (share x score per dimension). This module
// explains how it MOVED: each dimension that moved contributes its share x score delta, a dimension
// present on one side only is its own named step, and one explicit "rounding & reweighting" residual
// makes the bridge land exactly on the delta the ScoringTab DeltaPill shows. Pure: no React, no db.
//
// One derivation: shares come from `dimensionShares` (the same call `contributions()` makes), never
// re-multiplied from raw weights here. The baseline does not persist its weights, so the CURRENT
// shares price every step; what that approximation misses (a lens or dimension-set reweighting, and
// the headline's own rounding) is exactly the residual, stated rather than hidden.
//
// Exactness: points are carried as integer TENTHS (the display precision of fmtPts), and the residual
// is computed in tenths, so `from + sum(tenths) / 10 === to` holds with no float drift.

import type { DimensionId, ScanReport } from "@/lib/types";
import { dimensionShares } from "@/lib/scoring/projections";
import { sameRuler } from "@/lib/maturity/attribution";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";
import { MIXED_ENGINE_PAIR_LABEL, MIXED_ENGINE_PAIR_NOTE, mixesEngines } from "@/components/report/chartEngine";

/** The baseline scan the report diffs against: the HistoryPoint fields the bridge reads. */
export type ReportBaseline = {
  id: string;
  overallScore: number;
  engineProvider: string;
  rubricVersion: string | null;
  /** Undefined when the history join skipped dimensions: unknown, never zeros. */
  dimensions?: { dimId: string; score: number }[];
};

export type BridgeStepKind = "moved" | "entered" | "left" | "residual";

export type BridgeStep = {
  kind: BridgeStepKind;
  /** Null only on the residual step. */
  dimension: DimensionId | null;
  label: string;
  /** Signed overall points in integer tenths; null on a `left` step (its baseline weight is not
   *  recorded, so no number is fabricated for it and its effect is inside the residual). */
  tenths: number | null;
  points: number | null;
  scoreBefore: number | null;
  scoreNow: number | null;
  /** The current share that priced the step (null on `left` and `residual`). */
  share: number | null;
};

export type BridgeCaveatId = "mixed-engines" | "rubric-changed" | "rubric-unknown";
export type BridgeCaveat = { id: BridgeCaveatId; label: string; note: string };

export type ScoreBridgeResult =
  | { kind: "bridge"; from: number; to: number; delta: number; steps: BridgeStep[]; caveats: BridgeCaveat[] }
  | { kind: "unavailable"; reason: "no-baseline" | "no-dimensions" };

export const RESIDUAL_LABEL = "rounding & reweighting";

/** The integer-tenths total of a bridge's steps. `from + total / 10 === to`, exactly. */
export function bridgeTenthsTotal(steps: readonly BridgeStep[]): number {
  return steps.reduce((acc, s) => acc + (s.tenths ?? 0), 0);
}

function caveatsFor(report: ScanReport, baseline: ReportBaseline): BridgeCaveat[] {
  const out: BridgeCaveat[] = [];
  if (mixesEngines([baseline.engineProvider, report.engine?.provider])) {
    out.push({ id: "mixed-engines", label: MIXED_ENGINE_PAIR_LABEL, note: MIXED_ENGINE_PAIR_NOTE });
  }
  // A live/fresh report may omit its rubric stamp; it was scored under the current rubric by
  // construction (the in-memory cache key folds the rubric in), so that is its ruler.
  const nowRubric = report.engine?.rubricVersion ?? SCORING_RUBRIC_VERSION;
  const ruler = sameRuler(baseline.rubricVersion, nowRubric);
  if (ruler === false) {
    // The What Changed page's rubric caveat, worded for the bridge.
    out.push({
      id: "rubric-changed",
      label: "Scored under different rubrics",
      note: `These scans were scored under ${baseline.rubricVersion} and ${nowRubric}. The steps below include the rubric change, not the repository's movement alone.`,
    });
  } else if (ruler === null) {
    out.push({
      id: "rubric-unknown",
      label: "Rubric not recorded",
      note: "The last scan does not record the rubric it was scored under, so a rubric change cannot be ruled out.",
    });
  }
  return out;
}

const byMagnitude = (a: BridgeStep, b: BridgeStep) => {
  if (a.tenths === null || b.tenths === null) return (a.tenths === null ? 1 : 0) - (b.tenths === null ? 1 : 0);
  return Math.abs(b.tenths) - Math.abs(a.tenths) || (a.dimension ?? "").localeCompare(b.dimension ?? "");
};

/** Bridge the baseline's overall to this report's overall, one signed step per dimension that moved. */
export function scoreBridge(report: ScanReport, baseline: ReportBaseline | null | undefined): ScoreBridgeResult {
  if (!baseline) return { kind: "unavailable", reason: "no-baseline" };
  if (!baseline.dimensions) return { kind: "unavailable", reason: "no-dimensions" };

  const shares = dimensionShares(report.dimensions);
  const before = new Map(baseline.dimensions.map((d) => [d.dimId, d.score]));
  const steps: BridgeStep[] = [];

  for (const d of report.dimensions) {
    const share = shares.get(d.id) ?? 0;
    const prev = before.get(d.id);
    if (prev === undefined) {
      const tenths = Math.round(share * d.score * 10);
      steps.push({ kind: "entered", dimension: d.id, label: d.name, tenths, points: tenths / 10, scoreBefore: null, scoreNow: d.score, share });
      continue;
    }
    if (prev === d.score) continue;
    const tenths = Math.round(share * (d.score - prev) * 10);
    if (tenths === 0) continue; // below display precision: rides in the residual
    steps.push({ kind: "moved", dimension: d.id, label: d.name, tenths, points: tenths / 10, scoreBefore: prev, scoreNow: d.score, share });
  }
  const present = new Set<string>(report.dimensions.map((d) => d.id));
  for (const d of baseline.dimensions) {
    if (present.has(d.dimId)) continue;
    steps.push({ kind: "left", dimension: d.dimId as DimensionId, label: d.dimId, tenths: null, points: null, scoreBefore: d.score, scoreNow: null, share: null });
  }
  steps.sort(byMagnitude);

  const from = baseline.overallScore;
  const to = report.overallScore;
  const residual = Math.round((to - from) * 10) - bridgeTenthsTotal(steps);
  if (residual !== 0) {
    steps.push({ kind: "residual", dimension: null, label: RESIDUAL_LABEL, tenths: residual, points: residual / 10, scoreBefore: null, scoreNow: null, share: null });
  }
  return { kind: "bridge", from, to, delta: to - from, steps, caveats: caveatsFor(report, baseline) };
}
