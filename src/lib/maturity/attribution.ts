// ATTRIBUTION — when a score difference between two scans is allowed to be called a lift.
//
// The loop's whole promise is that each iteration raises quality *attributably*. A bare subtraction
// cannot make that claim, because two of the three ways an Ascent score moves have nothing to do with
// the repository:
//
//   1. THE ENGINE CHANGED. `scanRepository` falls to a deterministic mock floor when every real LLM
//      attempt fails (src/lib/scan.ts), and the resulting report persists like any other. A mock score
//      and a model-blended score are two different rulers; subtracting one from the other measures the
//      engine swap. This is the failure the UAT run recorded as a *silent success*.
//   2. THE MODEL WOBBLED. Measured live on 2026-08-10 (UAT `L2-NEW-01`): a 193-second model call moved
//      the overall score by about ±2 points against the deterministic detector, using ≤24% of its
//      guardband. So a 2-point "lift" on an unchanged repository is an ordinary outcome of running the
//      scan twice, not evidence of work.
//   3. The repository actually changed — the only one worth reporting.
//
// This module is the one place that decides between them. Pure, dependency-free and client-safe, so
// the cockpit's ledger, the follow-up resolve rule and the history strip all reach the SAME verdict
// instead of each re-deriving "did it go up" in its own idiom.
//
// It refuses in both directions on purpose. A regression that is inside the band, or measured across
// an engine swap, is not a regression either — reporting one would be the same error with the sign
// flipped, and would have the loop chasing noise it created.

import type { ScoreIntegrity } from "@/lib/types";
import { SCORE_BLEND } from "@/lib/maturity/model";

/** The engine name a degraded or keyless scan carries. Mirrors MockProvider.name. */
export const MOCK_ENGINE = "mock";

/**
 * How far the overall score can move between two scans of the SAME commit before the movement means
 * anything. ±2 points, from the live UAT measurement above: the model's realized contribution to the
 * headline was that size, so anything inside it is within one re-run of itself.
 *
 * A caveat worth keeping in view when this number is next revisited: the measurement is of the
 * OVERALL score, and the same band is applied below to a single dimension's score, where the model's
 * guardband is wider (`LLM_GUARDBAND` = 6, doubled on a widened dimension). Per-dimension the band is
 * therefore CONSERVATIVE — it will accept some movement that is still model wobble. It is not
 * tightened speculatively: the honest fix is a per-dimension measurement, not a guessed constant.
 */
export const SCORE_NOISE_BAND = 2;

/** The provenance an end of a comparison has to carry to be judged. `ComparableScan` satisfies it
 *  structurally, and so does a raw `{ engineProvider, engineDegraded }` row select. */
export interface EngineEnd {
  engineProvider: string;
  /** The mock floor FIRED: a model was requested and never answered. Undefined = unknown (a row
   *  written before the column), which is NOT the same as false. */
  engineDegraded?: boolean | null;
}

/**
 * Did a real engine produce this score? `mock` is the whole test: the floor and a keyless deploy both
 * report it, and neither ran a model. `engineDegraded` does not widen or narrow this — it only
 * explains WHY the engine is mock, which changes the wording a surface shows, never the verdict.
 */
export function isRealEngine(end: EngineEnd | null | undefined): boolean {
  return !!end && end.engineProvider !== MOCK_ENGINE;
}

export type Attribution =
  /** The pair is real on both ends and the movement clears the band. `delta` is signed. */
  | { kind: "attributable"; delta: number }
  /** One or both ends is missing — a first-ever scan, or a lane that never rescanned. */
  | { kind: "unmeasured" }
  /** At least one end came from the mock floor, so the two ends are not on the same ruler. */
  | { kind: "mock-scan"; delta: number; degraded: boolean }
  /** Real on both ends, but the movement is inside the band — including a movement of zero. */
  | { kind: "within-noise"; delta: number };

/**
 * The verdict for ONE before/after pair. Order of checks matters: an unmeasured pair is not a mock
 * pair, and a mock pair's delta is never evaluated against the band, because the band describes one
 * engine's wobble and says nothing about the distance between two different ones.
 *
 * `degraded` on the mock verdict distinguishes "no model is configured here" from "a model was asked
 * for and failed", because those call for opposite next moves by the operator.
 */
export function attributeScores(
  before: (EngineEnd & { overallScore: number }) | null | undefined,
  after: (EngineEnd & { overallScore: number }) | null | undefined,
): Attribution {
  if (!before || !after) return { kind: "unmeasured" };
  const delta = after.overallScore - before.overallScore;
  if (!isRealEngine(before) || !isRealEngine(after)) {
    return { kind: "mock-scan", delta, degraded: before.engineDegraded === true || after.engineDegraded === true };
  }
  return Math.abs(delta) > SCORE_NOISE_BAND ? { kind: "attributable", delta } : { kind: "within-noise", delta };
}

/**
 * The same rule over a delta whose ends have already been reduced to numbers plus the pair's engines —
 * for callers holding a per-DIMENSION movement rather than two whole scans. Kept as one function with
 * `attributeScores` deliberately: two rules that are "the same except" is how the loop's honesty
 * quietly diverges between the ledger and the resolve rule.
 */
export function attributeDelta(
  delta: number | null | undefined,
  before: EngineEnd | null | undefined,
  after: EngineEnd | null | undefined,
): Attribution {
  if (delta == null || !before || !after) return { kind: "unmeasured" };
  if (!isRealEngine(before) || !isRealEngine(after)) {
    return { kind: "mock-scan", delta, degraded: before.engineDegraded === true || after.engineDegraded === true };
  }
  return Math.abs(delta) > SCORE_NOISE_BAND ? { kind: "attributable", delta } : { kind: "within-noise", delta };
}

/** True only for a movement this rule will let a surface print as a green delta. */
export const isAttributableGain = (a: Attribution): boolean => a.kind === "attributable" && a.delta > 0;

/**
 * The one-line reason a surface shows INSTEAD of a delta when the movement is not attributable. Empty
 * string for an attributable pair — there is nothing to explain, the number speaks. Written as the
 * verdict a reader needs, not as a diagnostic: "not attributable" first, cause second.
 */
export function attributionLabel(a: Attribution): string {
  switch (a.kind) {
    case "attributable":
      return "";
    case "unmeasured":
      return "not measured";
    case "mock-scan":
      return a.degraded
        ? "not attributable: the model failed and this scan fell to the deterministic floor"
        : "not attributable: mock scan";
    case "within-noise":
      return `within noise (±${SCORE_NOISE_BAND})`;
  }
}

// ── Score integrity, as something a surface can render ──────────────────────────────────────────
//
// `ScoreIntegrity` was computed, typed and (UAT SAM-L1-02, 2026-08-10) rendered by nothing. It records
// the levers that move a headline on an UNCHANGED commit, which makes it the other half of the same
// question this module answers: not "did the engine change" but "did the SCORING change". Summarised
// here rather than in either consumer, so the report header and the cockpit ledger cannot describe the
// same record two different ways.

/** One thing that fired while scoring, as a chip label plus the sentence explaining it. */
export interface IntegrityNote {
  label: string;
  hint: string;
}

/**
 * The notes for one scan, or an empty array for a clean run — a clean run has nothing to say, and a
 * chip reading "integrity: fine" would be noise on every report that ever renders. `undefined` (a row
 * scored before the field, or before it was persisted) is also empty: unknown is not a finding.
 */
export function integrityNotes(si: ScoreIntegrity | undefined | null): IntegrityNote[] {
  if (!si) return [];
  const out: IntegrityNote[] = [];
  if (si.d9Unmeasurable) {
    out.push({
      label: "D9 renormalized out",
      hint: "The model asserted this repo's security runs where a file scan cannot see it, so D9 was treated as unmeasurable and removed from the overall and the rigor axis. At D9's weight that alone is a multi-point step on an identical commit.",
    });
  }
  if (si.widenCapped) {
    out.push({
      label: "audit capped",
      hint: "The model flagged more dimensions as mis-detected than the per-scan budget allows, so NOTHING was widened and the D9 hatch was suppressed — this run is pinned to the deterministic signals.",
    });
  } else if (si.widenedDims.length > 0) {
    out.push({
      label: `widened ${si.widenedDims.join(", ")}`,
      hint: `The model flagged the detector as suspect on ${si.widenedDims.join(", ")}, so its guardband there was DOUBLED. Those dimensions could move up to twice as far from their deterministic signal, so a run-over-run delta on them carries materially less confidence.`,
    });
  }
  if (si.effectiveBlend < SCORE_BLEND - 1e-9) {
    out.push({
      label: `blend ${Math.round((si.effectiveBlend / SCORE_BLEND) * 100)}%`,
      hint: `Only ${Math.round((si.effectiveBlend / SCORE_BLEND) * 100)}% of the model's usual weight was applied (${si.effectiveBlend.toFixed(2)} against a configured ${SCORE_BLEND}), because the ingest read a fraction of the repository. A thinner read shifts the score toward the deterministic signal with zero repository change.`,
    });
  }
  return out;
}

/** Compact form for a dense ledger row, where the long sentence would not fit. */
export function attributionChip(a: Attribution): string {
  switch (a.kind) {
    case "attributable":
      return "";
    case "unmeasured":
      return "not measured";
    case "mock-scan":
      return a.degraded ? "mock (degraded)" : "mock scan";
    case "within-noise":
      return `±${SCORE_NOISE_BAND} noise`;
  }
}
