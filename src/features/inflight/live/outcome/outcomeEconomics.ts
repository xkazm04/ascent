// WHAT ONE (RUN × REPO) CELL COST PER VERIFIED POINT — the sheet's half of the remediation ledger.
//
// The arithmetic is NOT here. `laneEconomics` (src/lib/local/lane-economics.ts) is the one place a
// lane's cost meets its measured movement, and this module only folds the lanes of one cell together
// and decides what may honestly be SAID about the fold. A second rate computed here would be a second
// source of truth for the product's headline number.
//
// WHY IT EXISTS (UAT `PRIYA-L1-704`). `getLoopRunDetail` has shipped `economics: LaneEconomics[]` to
// the browser on every detail read since the ledger landed, and `grep -rn "\.economics" src/features
// src/app` returned zero hits: the spec's named home (`CockpitOutcomeLedger.tsx`) was deleted by the
// wave-2 refactor and its replacement renders attribution, commits, gaps and `agentConfig` — no cost
// figure of any kind. So the only ¢/point on the page was the ORG-WIDE average, which is exactly the
// figure that hid a lane spending $10.19 for 0 verified points.
//
// THE HONESTY RULES, all three inherited rather than invented:
//
//  1. A RATE IS ONLY PRINTED WHEN THE WHOLE CELL IS PRICED. A cell can hold more than one lane (an
//     A/B run works one repo twice in one cycle). Dividing a cost that omits an unpriced lane, or
//     points that omit an unmeasured one, gives a number that is confidently wrong — so any missing
//     side makes the rate null, and the cell says which side was missing.
//  2. `0` POINTS IS NOT "NOT MEASURED". Spend that bought no measurable movement is the honest half
//     of the ledger and the whole reason this finding was filed: it is reported as spend with a zero
//     beside it, never as an absent measurement and never averaged into anyone's rate (G18).
//  3. NO COST REPORTED IS NOT FREE. `costMicros: null` means the CLI's envelope said nothing.

import type { LaneEconomics } from "../cockpit/loopTypes";

export interface CellEconomics {
  /** Total micro-cents this cell's lanes reported. `null` = not one of them reported a cost. */
  costMicros: number | null;
  /** Total positive dimension movement. `null` = no lane had a measurable scan pair. */
  verifiedPoints: number | null;
  /** `costMicros / verifiedPoints`, micro-cents. `null` whenever rule 1 or rule 2 forbids a rate. */
  microsPerVerifiedPoint: number | null;
  /** Lanes in this cell whose cost the envelope never reported — the coverage caveat, never hidden. */
  unpricedLanes: number;
  /** Lanes with no measurable before/after pair. A rate over these would divide by a guess. */
  unmeasuredLanes: number;
  /** Spent real money and moved nothing measurable. Rule 2's case, counted rather than blanked. */
  unproductive: boolean;
  /** How many lanes are folded in — an A/B cell's figure is the sum of two attempts, not one. */
  lanes: number;
}

const sumOrNull = (values: readonly (number | null)[]): number | null => {
  const known = values.filter((v): v is number => v != null);
  return known.length === 0 ? null : known.reduce((n, v) => n + v, 0);
};

/**
 * Fold the economics of one cell's lanes. Returns null when the cell has no lane economics at all —
 * a payload from a server older than the ledger, which must render nothing rather than a zero.
 */
export function cellEconomics(rows: readonly LaneEconomics[]): CellEconomics | null {
  if (rows.length === 0) return null;
  const costMicros = sumOrNull(rows.map((r) => r.costMicros));
  const verifiedPoints = sumOrNull(rows.map((r) => r.verifiedPoints));
  const unpricedLanes = rows.filter((r) => r.costMicros == null).length;
  const unmeasuredLanes = rows.filter((r) => r.verifiedPoints == null).length;
  // Rule 1 and rule 2 together: every lane priced, every lane measured, and something to divide by.
  const complete = unpricedLanes === 0 && unmeasuredLanes === 0 && costMicros != null && verifiedPoints != null;
  return {
    costMicros,
    verifiedPoints,
    microsPerVerifiedPoint: complete && verifiedPoints > 0 ? costMicros / verifiedPoints : null,
    unpricedLanes,
    unmeasuredLanes,
    // A lane with no cost recorded cannot be called unproductive — nobody knows what it spent.
    unproductive: complete && costMicros > 0 && verifiedPoints === 0,
    lanes: rows.length,
  };
}

/** Micro-cents as money, on the ledger's own thresholds: `4231` → `"4.23¢"`, `1019000000` → `"$10.19"`. */
export function fmtCostMicros(micros: number): string {
  const cents = micros / 1_000_000;
  return cents < 100 ? `${cents.toFixed(2)}¢` : `$${(cents / 100).toFixed(2)}`;
}

/** What the cell says about its own spend, and why. Null renders nothing at all. */
export interface EconomicsLabel {
  text: string;
  title: string;
  /** Spend that bought nothing measurable — the one case the sheet tones as a warning. */
  warn: boolean;
}

/**
 * The one sentence a cell may say about its economics. Four cases, in the order they are asked:
 *
 *  1. a complete rate — the figure the whole ledger exists to produce;
 *  2. **spend with zero points** — stated as money beside a zero, never as "not measured". This is
 *     the case the finding was filed over: a lane spent $10.19 for 0 verified points and the page
 *     showed only an org-wide average that hid it;
 *  3. spend that cannot yet be divided — the money is real, so it is shown, and the caveat names
 *     which half is missing;
 *  4. no cost reported at all — said in words, because a blank reads as free.
 */
export function economicsLabel(e: CellEconomics | null): EconomicsLabel | null {
  if (!e) return null;
  const caveat = [
    e.unpricedLanes > 0 ? `${e.unpricedLanes} lane${e.unpricedLanes === 1 ? "" : "s"} reported no cost` : null,
    e.unmeasuredLanes > 0 ? `${e.unmeasuredLanes} lane${e.unmeasuredLanes === 1 ? "" : "s"} had no scan pair to measure` : null,
  ]
    .filter((x): x is string => x !== null)
    .join("; ");
  const spread = e.lanes > 1 ? ` Folded over ${e.lanes} lanes on this repository in this run.` : "";

  if (e.microsPerVerifiedPoint != null && e.costMicros != null) {
    return {
      text: `${fmtCostMicros(e.microsPerVerifiedPoint)}/pt`,
      title: `${fmtCostMicros(e.costMicros)} spent for ${e.verifiedPoints} verified point${e.verifiedPoints === 1 ? "" : "s"} — positive dimension movement across a measured before/after pair.${spread}`,
      warn: false,
    };
  }
  if (e.unproductive && e.costMicros != null) {
    return {
      text: `${fmtCostMicros(e.costMicros)} · 0 pts`,
      title: `Spent and measured, and nothing moved. This is real spend that bought no verified maturity point; it is stated here rather than averaged into the organization's rate.${spread}`,
      warn: true,
    };
  }
  if (e.costMicros != null) {
    return {
      text: `${fmtCostMicros(e.costMicros)} · not measured`,
      title: `The spend is known; the rate is not. ${caveat || "No verified points could be divided into it."}${spread}`,
      warn: false,
    };
  }
  return {
    text: "cost not reported",
    title: `The agent's own envelope reported no cost for this work, so nothing here is free — it is unknown.${spread}`,
    warn: false,
  };
}
