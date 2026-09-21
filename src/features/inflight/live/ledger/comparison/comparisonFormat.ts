// THE COMPARISON READOUT'S WORDS — pure, so every rule about what may and may not be printed is a
// fact about a function a test can pin without a renderer.
//
// The rules this module exists to make unbreakable:
//   - the optimized metric always carries its DIRECTION ("lower is better"), because a reader must
//     not have to already know which way is good to read the winner;
//   - a conditioned figure cannot be formatted without its subset size — `subsetLine` takes both
//     populations and there is no single-argument way to print one;
//   - a null observation is UNMEASURED, never "cleared" and never 0;
//   - void / parked / timed-out are OUTCOMES with a standing reason, so they are rows even at zero
//     rather than rows that appear only when something went wrong.
//
// COST UNITS. `Counted<number | null>` carries no unit. This repo's one cost unit is micro-cents
// (`costMicros`, agent-envelope.ts), so that is what the cost views are formatted as; `fmtUsd` is the
// ledger's own money voice, reused rather than re-derived.

import type { ArmResult, ConstraintVerdict, Counted, Reliability } from "@/lib/local/compare-metrics";
import { fmtUsd, plural } from "../ledgerFormat";

/** Said on the surface beside the headline. The metric is `at-most`: fewer Claude tokens per point. */
export const OPTIMIZED_DIRECTION = "lower is better";

const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** The optimized metric. Null is a finding ("no verified points"), never a zero. */
export function fmtMetric(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : INT.format(v);
}

export const fmtInt = (n: number): string => INT.format(n);

/** "66.7%" — a rate. Null reads "—", because an unmeasured rate is not 0%. */
export function fmtRate(x: number | null | undefined): string {
  return x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(1)}%`;
}

/**
 * The population line a conditioned figure may not be printed without.
 *
 * Both populations are arguments because the count is the whole point: "294 of 300" is a refinement
 * of the same study, "104 of 300" is a different one, and only the pair tells the reader which they
 * are reading.
 */
export function subsetLine(subset: Counted<unknown>, all: Counted<unknown>): string {
  return `${fmtInt(subset.n)} of ${fmtInt(all.n)} trials — ${subset.predicate}`;
}

/** The unconditioned population, which still carries its own n and predicate. */
export function populationLine(all: Counted<unknown>): string {
  return `${plural(all.n, "trial")} — ${all.predicate}`;
}

export const fmtCost = (c: Counted<number | null>): string => fmtUsd(c.value);

export type ConstraintState = "cleared" | "breached" | "unmeasured";

/** A null observation is UNMEASURED. `cleared: null` means the same thing and is treated the same. */
export function constraintState(v: ConstraintVerdict): ConstraintState {
  if (v.observed == null || v.cleared == null) return "unmeasured";
  return v.cleared ? "cleared" : "breached";
}

/** "≤ 3" / "≥ 0.9" — the declared threshold, always visible beside the observation. */
export function constraintBound(v: ConstraintVerdict): string {
  const sign = v.constraint.direction === "at-most" ? "≤" : "≥";
  return `${sign} ${v.constraint.threshold}`;
}

export const CONSTRAINT_WORD: Record<ConstraintState, string> = {
  cleared: "CLEARED",
  breached: "BREACHED",
  unmeasured: "UNMEASURED",
};

export interface ReliabilityLine {
  key: "any" | "all";
  label: string;
  value: string;
  about: string;
}

/**
 * BOTH figures, each with its N. They answer opposite questions — "is this achievable at all" versus
 * "can this be relied upon unattended" — and at a two-in-three per-trial rate they sit ~96% and ~30%
 * apart. Printing one where two were computed is the specific way this readout would mislead.
 */
export function reliabilityLines(r: Reliability): ReliabilityLine[] {
  return [
    {
      key: "any",
      label: `any of ${r.n}`,
      value: fmtRate(r.anyOfN),
      about: "At least one trial in N succeeds — the question when a person or the harness will retry.",
    },
    {
      key: "all",
      label: `all of ${r.n}`,
      value: fmtRate(r.allOfN),
      about: "Every trial in N succeeds — the question behind letting it run unattended.",
    },
  ];
}

export const MODELLED_NOTE =
  "Modelled: compounded from the per-trial rate, which assumes trials are independent. They are not when a task has a hard case the arm reliably misses.";

export interface OutcomeRow {
  key: "landed" | "failed" | "voided" | "parked" | "timedOut";
  label: string;
  count: number;
  /** Why lanes end up here. A void lane without its reason reads as a gap in the data. */
  reason: string;
}

/** Every outcome, always — including the zeros. A void lane that is simply absent flatters its arm. */
export function outcomeRows(a: ArmResult): OutcomeRow[] {
  return [
    { key: "landed", label: "Landed", count: a.landed, reason: "Verified work landed on the runner branch." },
    { key: "failed", label: "Failed", count: a.failed, reason: "The lane ran and did not produce verified work." },
    {
      key: "voided",
      label: "Void",
      count: a.voided,
      reason: "The lane edited the surface that scores it, so its result is excluded from the metric — reported, never dropped.",
    },
    {
      key: "parked",
      label: "Parked",
      count: a.parked,
      reason: "The plan could not be parsed. For an arm below the capability floor this counts as a failure — that is what makes the floor measurable.",
    },
    {
      key: "timedOut",
      label: "Timed out",
      count: a.timedOut,
      reason: "Stopped by this arm's own ceiling, so the timeout is attributable to the arm rather than anonymous.",
    },
  ];
}

export const BELOW_FLOOR_NOTE =
  "Below the recorded capability floor: opt-in, always labelled, and its parked batches count as failures rather than being discarded.";

export const NO_ADVANCE_FALLBACK =
  "No arm advanced, and the report recorded no reason — treat the absence as unexplained, not as a tie.";
