// HOW ONE DIMENSION'S NUMBER WAS ACTUALLY PRODUCED — the single reader-facing answer, derived from
// the same constants the engine blends with, so a surface can never draw a mechanism the engine does
// not run.
//
// The engine (scoring/engine.ts, the `const score =` ladder) has exactly three branches, and they are
// materially different promises to a reader:
//
//   claim-scored (D1, D4)  score = signal + VERIFIED claim points. There is NO guardband and no
//                          judgment blend: the model's `score` field is recorded and ignored, and the
//                          only way it moves the number is by citing a sampled path + verbatim quote
//                          the verifier confirms. Drawing a ±band and an "LLM judgment" tick here
//                          draws a lever that does not exist (G10 keeps D1 claim-scored).
//   signal-only (D9)       score IS the deterministic security battery's score. The model narrates it
//                          (summary/gaps) and never moves it.
//   blended (everything else)  the model's score is CLAMPED to ±band of the signal — band doubled on a
//                          dimension the model flagged as mis-detected (scoreIntegrity.widenedDims) —
//                          and then confidence-weighted at `effectiveBlend`. So the distance the model
//                          can actually move the rendered number is `blend × band`, not `band`.
//
// Pure + dependency-free so a client chart imports it directly. It reports what it can prove and says
// so when it cannot: with no `scoreIntegrity` (a legacy row, or a projection that dropped it) the
// widening and the realized blend weight are UNKNOWN, and an unknown weight is reported as `null`
// rather than assumed to be the configured constant.

import { LLM_GUARDBAND, SCORE_BLEND } from "@/lib/maturity/model";
import { CLAIM_SCORED_DIMENSIONS } from "@/lib/scoring/claims";
import type { DimensionId, ScoreIntegrity } from "@/lib/types";

/** Dimensions whose final score IS the deterministic signal (`DimensionSignals.deterministic`). Kept
 *  in lockstep with the producer by `provenance.test.ts`, which reads `scan-score-input.ts` and fails
 *  if a dimension is flagged deterministic there and missing here. */
export const SIGNAL_ONLY_DIMENSIONS: readonly DimensionId[] = ["D9"];

export type ScoreProvenance =
  /** D1/D4 — no band, no judgment blend; `claimPoints` is what verified citations awarded. */
  | { kind: "claim-scored"; claimPoints: number }
  /** D9 — the check battery's number, verbatim. */
  | { kind: "signal-only" }
  /** Guardbanded + confidence-weighted. `reach` is the honest ±distance from the signal. */
  | {
      kind: "blended";
      /** ±clamp applied to the model's raw score before weighting. Doubled on a widened dimension. */
      clampBand: number;
      /** The model flagged this detector as suspect, so the clamp was DOUBLED. */
      widened: boolean;
      /** The REALIZED blend weight (`scoreIntegrity.effectiveBlend`), or null when unknowable. */
      blend: number | null;
      /** How far the rendered score can sit from the signal: `round(blend × clampBand)`, or the full
       *  clamp band when the weight is unknown (never understate the uncertainty). */
      reach: number;
    };

export function scoreProvenance(
  d: { id: DimensionId; signalScore: number; score: number },
  integrity?: ScoreIntegrity | null,
): ScoreProvenance {
  if ((CLAIM_SCORED_DIMENSIONS as readonly string[]).includes(d.id)) {
    return { kind: "claim-scored", claimPoints: d.score - d.signalScore };
  }
  if ((SIGNAL_ONLY_DIMENSIONS as readonly string[]).includes(d.id)) {
    return { kind: "signal-only" };
  }
  const widened = integrity?.widenedDims?.includes(d.id) ?? false;
  const clampBand = widened ? LLM_GUARDBAND * 2 : LLM_GUARDBAND;
  const blend =
    typeof integrity?.effectiveBlend === "number" && Number.isFinite(integrity.effectiveBlend)
      ? integrity.effectiveBlend
      : null;
  const reach = blend === null ? clampBand : Math.round(blend * clampBand);
  return { kind: "blended", clampBand, widened, blend, reach };
}

// ── ONE UNIT for the blend weight ───────────────────────────────────────────────────────────────
//
// The report page carries the weight twice: the header's integrity chip and every blended dimension's
// provenance track. They were composed independently and printed the SAME fact in two units — the chip
// as the realized *share of the configured weight* ("blend 95%", 0.57 against 0.6) and the track as the
// *absolute weight* ("Blend weight 57%") — reconciled only inside the chip's tooltip, on the exact
// surface whose prior finding was that it stated one number three ways (UAT `RC-N1`).
//
// So the unit is decided here, once, and both surfaces read it. The unit is the ABSOLUTE weight,
// because that is the number the engine multiplies by: `reach = blend × clampBand` is drawn from it,
// and a share-of-configured cannot be multiplied by anything on the page. The configured weight rides
// along in the chip's label so "this was reduced" stays legible without a second unit.

/** The blend weight as a whole percent — the one number both surfaces print. */
export function blendWeightPercent(blend: number): number {
  return Math.round(blend * 100);
}

/** The chip's short form: the same percent the tracks print, with the configured weight as context. */
export function blendWeightLabel(blend: number): string {
  return `blend weight ${blendWeightPercent(blend)}% of ${blendWeightPercent(SCORE_BLEND)}%`;
}
