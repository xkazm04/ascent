// Guidance coherence as a SPREAD — the fleet reading the card used to give as a mean and a headline.
//
// "Mean coherence 71" over 40 repos says nothing about whether the fleet is uniformly middling or
// split between a set of clean repos and a handful where an agent gets two different answers. That
// is a distribution, and `Distribution` from the /org viz kit draws it (docs/ORG-UX-REDESIGN.md
// §2.2). The five numbers are computed here so the plot and its generated sr-only table cannot drift.
//
// The denominator rule of guidanceCoherenceModel.ts is preserved exactly: a repo with `coherence:
// null` — not assessed, or carrying no guidance document — is EXCLUDED from the box and counted as
// `not-judged` beside it. It is not a repo scoring zero, and the hatch says so.
//
// Pure: no React, no fetch.

import type { VizState } from "@/components/org/viz";
import { quantiles, type FiveNumber } from "../fleetShape";
import type { RepoCoherenceRow } from "./guidanceCoherenceModel";

export interface CoherenceSpread {
  /** Five-number summary over assessed repos, or null below two of them. */
  five: (FiveNumber & { n: number }) | null;
  measured: number;
  /** Not assessed, or no guidance document to assess — in no quartile, and never a zero. */
  unmeasured: number;
  states: VizState[];
}

export function coherenceSpread(rows: readonly RepoCoherenceRow[]): CoherenceSpread {
  const scores = rows.map((r) => r.coherence).filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  const states: VizState[] = [];
  if (scores.length > 0) states.push("measured");
  if (rows.length - scores.length > 0) states.push("not-judged");
  return {
    five: quantiles(scores),
    measured: scores.length,
    unmeasured: rows.length - scores.length,
    states,
  };
}
