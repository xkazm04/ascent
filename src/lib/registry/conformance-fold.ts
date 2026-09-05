// The worst-wins fold of a repo's judged pairs into ONE cell per subject — the pure rule behind
// `KnowledgeCell` (`src/lib/org/knowledge-shape.ts`).
//
// This is the same fold `src/features/shared/registry/conformanceModel.ts` `buildMatrix` performs
// for the Registry tab, re-stated here because `src/lib/**` may not import from `src/features/**`.
// The rank is IDENTICAL by construction and the feature module should point at this one (WP4).
//
// WHY WORST WINS: one deviation in one context makes the cell a deviation even if four other
// contexts are conformant. A cell that averaged them would let a real, evidenced departure
// disappear behind its neighbours — the one thing the matrix exists to prevent. `unjudged` ranks
// above nothing but absence: it is "nobody looked", never a tick.

import type { ConformanceState } from "./conformance-map";
import type { KnowledgeCellState } from "@/lib/org/knowledge-shape";

/** Higher wins. Shared vocabulary with `buildMatrix`'s `rank` in the feature module. */
export const CELL_RANK: Record<ConformanceState, number> = { deviation: 4, conformant: 3, "not-applicable": 2, unjudged: 1 };

/** The map's `unknown` / `unevaluated` word (parsed as `unjudged`) is the contract's `unknown`. */
export const toCellState = (state: ConformanceState): KnowledgeCellState => (state === "unjudged" ? "unknown" : state);

export interface FoldablePair {
  state: ConformanceState;
  evidence: string | null;
  evaluatedAgainst: string | null;
}

export interface FoldedCell {
  state: KnowledgeCellState;
  /** How many of the repo's contexts pair the subject. */
  contexts: number;
  /** The worst pair's evidence, verbatim. */
  evidence: string | null;
  /** The worst pair's verdict was written against a digest that is not the subject's current one.
   *  False when either side is unknown — an unknown digest is not evidence of staleness. */
  stale: boolean;
}

/** Is a JUDGED pair's verdict older than the subject's digest? Both sides must be known. */
export function isStalePair(pair: FoldablePair, digest: string | null): boolean {
  if (pair.state === "unjudged") return false;
  return pair.evaluatedAgainst !== null && digest !== null && pair.evaluatedAgainst !== digest;
}

/** A pair that still owes a verdict: unjudged, or judged against a digest the registry has moved past. */
export const isUnknownOrStale = (pair: FoldablePair, digest: string | null): boolean =>
  pair.state === "unjudged" || isStalePair(pair, digest);

/**
 * Fold a subject's pairs for one repo. Returns null for no pairs — the caller classifies the
 * ABSENCE instead (`classifyAbsence`), which is a different fact from any verdict.
 */
export function foldPairs(pairs: FoldablePair[], digest: string | null): FoldedCell | null {
  if (!pairs.length) return null;
  let worst = pairs[0]!;
  for (const p of pairs) if (CELL_RANK[p.state] > CELL_RANK[worst.state]) worst = p;
  return {
    state: toCellState(worst.state),
    contexts: pairs.length,
    evidence: worst.evidence,
    stale: isStalePair(worst, digest),
  };
}
