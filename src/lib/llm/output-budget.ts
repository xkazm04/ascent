// The god-scan indicator: is one assessment call outgrowing a single model response?
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE FAILURE THIS EXISTS TO CATCH.
//
// Ascent scores a repository with ONE LLM call. That call is asked to produce, in a single
// structured response: nine dimension scores with rationales, the discrepancy self-audit, and the
// prioritized roadmap. Every rubric change adds to it. There is a hard ceiling — the model's max
// output tokens — and the failure mode at that ceiling is NOT an error. It is a TRUNCATED response:
// the JSON parser recovers what it can, dimensions the model never reached come back missing, and
// the engine renormalizes over what survived. A scan that quietly scored six dimensions instead of
// nine looks exactly like a scan of a repo that is weak in three areas.
//
// So the number worth watching is OUTPUT tokens against the model's cap. Input growth costs money;
// output growth costs correctness. When a fleet's scans routinely sit near the ceiling, the answer
// is not a bigger model — it is to split the assessment (per-dimension calls, or a separate roadmap
// pass), which is the modularization decision this signal exists to trigger.
//
// Deliberately a MEASUREMENT, not a guard. Nothing here blocks or retries a scan: the ceiling is a
// property of how the product is built, and the right response is a design change, not a runtime
// fallback that hides the growth.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Max output tokens per model family, longest-prefix matched on the persisted engine model id. */
const OUTPUT_CAPS: { prefix: string; cap: number }[] = [
  { prefix: "gemini-3.7-flash", cap: 65_536 },
  { prefix: "gemini-3.5-flash", cap: 65_536 },
  // The retired preview default. Set to the Gemini 3 family limit rather than the legacy 8,192 of
  // the 2.0 generation: I could not verify the preview's own published cap, and asserting the lower
  // number would have manufactured a truncation warning on historical scans that may never have
  // truncated. When a cap is unknown the honest move is the family default, not the scarier guess.
  { prefix: "gemini-3-flash", cap: 65_536 },
  // Claude, via the CLI aliases and full ids alike.
  { prefix: "claude-opus-5", cap: 64_000 },
  { prefix: "claude-sonnet-5", cap: 64_000 },
  { prefix: "opus", cap: 64_000 },
  { prefix: "sonnet", cap: 64_000 },
  { prefix: "haiku", cap: 8_192 },
  { prefix: "anthropic.claude-opus-4", cap: 32_000 },
  { prefix: "anthropic.claude-sonnet-4", cap: 64_000 },
  { prefix: "anthropic.claude-haiku-4", cap: 8_192 },
  { prefix: "gpt-4o", cap: 16_384 },
];

/**
 * Conservative cap for a model we do not recognize.
 *
 * 8k, not something generous: an unknown model treated as roomy would suppress the very warning this
 * module exists to raise. Under-estimating a cap raises a warning that turns out to be early;
 * over-estimating it stays silent through the truncation.
 */
export const FALLBACK_OUTPUT_CAP = 8_192;

/** Fraction of the cap at which the assessment is worth watching. */
export const APPROACHING = 0.6;
/** Fraction at which truncation is a live risk and modularization is the real fix. */
export const AT_RISK = 0.85;

export type BudgetLevel = "ok" | "approaching" | "at-risk";

export interface OutputBudget {
  outputTokens: number;
  cap: number;
  /** 0..100 — share of the model's output ceiling this scan actually used. */
  usedPct: number;
  level: BudgetLevel;
  /** True when the cap is the conservative fallback rather than a known model's real limit. */
  capIsAssumed: boolean;
}

/** The output cap for a model id, and whether it was assumed. Pure. */
export function outputCapFor(model: string | null | undefined): { cap: number; assumed: boolean } {
  const id = (model ?? "").trim().toLowerCase().replace(/^(us|eu|apac|global)\./, "");
  if (!id) return { cap: FALLBACK_OUTPUT_CAP, assumed: true };
  let best: { prefix: string; cap: number } | null = null;
  for (const c of OUTPUT_CAPS) {
    if (id.startsWith(c.prefix) && (best === null || c.prefix.length > best.prefix.length)) best = c;
  }
  return best ? { cap: best.cap, assumed: false } : { cap: FALLBACK_OUTPUT_CAP, assumed: true };
}

/**
 * Classify one scan's output usage against its model's ceiling. Pure.
 *
 * Returns null when the provider reported no output tokens — the mock engine and any provider that
 * does not surface usage. Null is "not measured": reporting 0% used would say the assessment is
 * comfortably small when in fact nothing was measured at all.
 */
export function classifyOutputBudget(outputTokens: number | null | undefined, model: string | null | undefined): OutputBudget | null {
  if (typeof outputTokens !== "number" || !Number.isFinite(outputTokens) || outputTokens <= 0) return null;
  const { cap, assumed } = outputCapFor(model);
  const ratio = outputTokens / cap;
  return {
    outputTokens,
    cap,
    usedPct: Math.round(ratio * 100),
    level: ratio >= AT_RISK ? "at-risk" : ratio >= APPROACHING ? "approaching" : "ok",
    capIsAssumed: assumed,
  };
}

/**
 * The scan-report warning for a budget that has crossed a threshold, or null.
 *
 * Names the ceiling AND the remedy. "Approaching a limit" with no stated consequence reads as noise;
 * the consequence here is specific (dimensions silently missing from a truncated response) and so is
 * the fix (split the assessment), which is the whole point of measuring this.
 */
export function outputBudgetWarning(b: OutputBudget | null): string | null {
  if (!b || b.level === "ok") return null;
  const assumed = b.capIsAssumed ? " (assumed for an unrecognized model)" : "";
  if (b.level === "at-risk") {
    return (
      `This assessment used ${b.usedPct}% of the model's ${b.cap.toLocaleString()}-token output limit${assumed}. ` +
      "At this size a response can be truncated mid-structure, which drops dimensions silently rather than failing — " +
      "the assessment should be split into smaller calls."
    );
  }
  return (
    `This assessment used ${b.usedPct}% of the model's ${b.cap.toLocaleString()}-token output limit${assumed}. ` +
    "Still comfortable, but the single-call assessment is growing toward the ceiling."
  );
}
