// The dimension ledger's headline reading, as a view model: which SDLC phase carries the debt.
//
// The ledger used to open on a sentence — "N of 9 dimensions still owe a follow-up (below 65). Each
// row names the practice that lifts it and the repos it touches." — above a nine-row table. The
// sentence counted the debt but never located it, and locating it is the question the phase grouping
// exists to answer: is it how we AUTHOR, how we VERIFY, or how we SHIP that is weak? Three bars
// against the green threshold answer that at first sight; the table below stays for the detail.
//
// Pure: no React. The type-only kit import is erased at compile time.

import type { VizState } from "@/components/org/viz";
import { FOLLOW_UP_BELOW } from "@/lib/maturity/model";
import { groupByPhase, type DimensionReading } from "./dimensionReading";

export interface PhaseStanding {
  id: string;
  /** The phase's mono kicker label. */
  label: string;
  /** The question the phase answers about the fleet — the row's `<title>` when it has one. */
  question: string;
  /** Mean of the member dimensions' averages; null wherever the state renders no value. */
  avg: number | null;
  state: VizState;
  /** Member dimensions below the green band, and how many members the phase has. */
  owed: { n: number; of: number };
}

/** The green band's floor — the rule every phase bar is drawn against. Re-exported so the strip and
 *  its test read the threshold from the maturity model rather than re-typing 65. */
export const GREEN_FLOOR = FOLLOW_UP_BELOW;

/**
 * One standing per SDLC phase, in phase order.
 *
 * The state is the point. A phase whose dimensions are backed by REAL scored repos is `measured`. A
 * phase whose every dimension has `belowGreen.of === 0` — an average with no scored repository
 * behind it, which the ledger row already words as "no repos scored on this dimension" — is
 * `not-judged`, and `rendersValue("not-judged")` is false, so the strip CANNOT print that average
 * as though it were an observation. A phase the rollup returned no dimensions for at all is
 * `missing`: a void, not a zero-height bar.
 */
export function phaseStandings(readings: DimensionReading[]): PhaseStanding[] {
  return groupByPhase(readings).map((g) => {
    const scored = g.rows.filter((r) => r.belowGreen.of > 0);
    const state: VizState = g.rows.length === 0 ? "missing" : scored.length === 0 ? "not-judged" : "measured";
    return {
      id: g.phase.id,
      label: g.phase.label,
      question: g.phase.question,
      avg: state === "measured" ? g.avg : null,
      state,
      owed: { n: g.rows.filter((r) => r.owed).length, of: g.rows.length },
    };
  });
}

/** How many of `readings` still owe a follow-up, and out of how many — the count the deleted
 *  sentence carried, kept as a scope readout (a number, not a claim) beside the strip. */
export function owedCount(readings: DimensionReading[]): { n: number; of: number } {
  return { n: readings.filter((r) => r.owed).length, of: readings.length };
}
