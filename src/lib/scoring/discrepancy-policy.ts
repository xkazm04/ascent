// The discrepancy BUDGET — the one place that decides how much latitude a model's self-reported
// "the detector is wrong" claim can buy it, shared by the prompt (which states the budget) and the
// engine (which enforces it).
//
// Why a budget exists at all (G3-02 + G3-06, one path): repo file content enters the prompt, and a
// `discrepancies` entry DOUBLES that dimension's guardband (±25 → ±50) with no independent
// corroboration. Together those are a repo-authored channel into how far the model may move the
// number about that same repo. The prompt boundary (scoring/prompt.ts) removes the *authority* of
// repo text; this budget removes the *payoff* of getting an extra discrepancy emitted anyway:
//
//  - at most MAX_FLAGGED_DIMENSIONS dimensions can be widened on one scan, and
//  - if MORE than that are flagged, NONE are widened (a scan whose audit claims most detectors are
//    broken is not a scan where the model has earned more trust — it is a scan whose discrepancy
//    channel is unreliable, whether from a hallucination or from planted text).
//
// All-or-nothing rather than "keep the first N" on purpose: any "keep N" rule needs a tie-break the
// model can steer (ordering), and a partially-honoured blanket claim is the worst of both.
// Corroboration by re-running the detector — the ideal fix — is not available here: the engine
// receives already-computed signals, so the budget is the enforceable half.
//
// This budget is why `discrepancies` is classified `consequential` in REPO_OUTPUT_PAYOFF
// (src/lib/llm/untrusted.ts) — the machine-readable record of which output channel an injection would
// actually want, kept beside the boundary prose that steers attempts away from this one and into the
// inert `risks` channel. If a change here alters what a discrepancy can buy, that classification (and
// the boundary prose promising `risks` is harmless) is the other half to re-read.
export const MAX_FLAGGED_DIMENSIONS = 2;

/** The dimensions a discrepancy may actually widen, after the budget. */
export interface WidenDecision<T extends string> {
  /** Dimensions whose guardband is doubled. Empty when the budget was blown. */
  widened: Set<T>;
  /** True when more than MAX_FLAGGED_DIMENSIONS eligible dimensions were flagged, so none widened. */
  capped: boolean;
  /** How many eligible dimensions the model flagged (reported in the capped warning). */
  flaggedCount: number;
}

/**
 * Apply the budget to the ELIGIBLE flagged dimensions — the ones that could actually be widened
 * (a deterministic dimension, a failed/dropped detector or an unknown id can't be, so counting them
 * would blow the budget on claims that never moved a number).
 */
export function applyDiscrepancyBudget<T extends string>(eligible: Iterable<T>): WidenDecision<T> {
  const flagged = new Set(eligible);
  const capped = flagged.size > MAX_FLAGGED_DIMENSIONS;
  return { widened: capped ? new Set<T>() : flagged, capped, flaggedCount: flagged.size };
}
