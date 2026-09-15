// What the Tech Stacks tab actually KNOWS about each stack, and what it does not — the one place the
// tab decides "measured" vs "no measurement", so the rail, the radar, the legend and the spread all
// agree. Pure + server-safe; unit-tested (stackMeasure.test.ts) because the honesty is the point.
//
// Two absences hide inside a `SegmentSummary` and both used to surface as a NUMBER:
//
//  1. A stack with no scanned repo. `summarizeScopedRepos` (src/lib/db/segments.ts) used to reduce
//     its averages through a `roundedMean([])` that returned `Math.round(0)` — so `avgOverall` came
//     back 0. The rail printed that 0 in `scoreHex(0)` (red) and the panel sorted the stack to the
//     bottom of a leaderboard as if it were the worst stack in the fleet. It is not a bad stack; it
//     is an unread one. FIXED AT THE PRODUCER (2026-09-08): `roundedMean` returns null for an empty
//     list and `SegmentSummary.avgOverall` is `number | null`, so this module now reads the absence
//     off the field it is drawing instead of inferring it from `scannedCount`, one field over. That
//     inference was correct here and wrong in two sibling surfaces, which is why it moved.
//  2. A stack that IS scanned but carries no average for a given dimension — its scans predate that
//     dimension, so it has no vote. `fleetAnalysis.ts` already excludes those points from every
//     verdict; the radar coerced them with `?? 0` and drew the profile into the centre on that
//     spoke.
//
// Both are `not-judged` / `missing` in the shared vocabulary, never zero.

import type { VizState } from "@/components/org/viz";
import type { SegmentSummary } from "@/lib/db";

/** A stack whose fleet average exists — the only stack that can be plotted, scored or ranked. */
export type MeasuredStack = SegmentSummary & { avgOverall: number };

/** Narrowing form of {@link stackState}: `measured` as a type predicate, so a caller that has asked
 *  the question keeps the answer. A 0 passes — 0 is a real score when someone looked. */
export function isMeasured(s: SegmentSummary): s is MeasuredStack {
  return s.avgOverall !== null;
}

/** A stack is `measured` once it carries a fleet average; otherwise nothing about it was judged. */
export function stackState(s: Pick<SegmentSummary, "avgOverall">): VizState {
  return s.avgOverall !== null ? "measured" : "not-judged";
}

/**
 * Per-dimension averages aligned to `dims`, with `null` — never 0 — where the stack carries none.
 * The radar plots these directly, so an absent average becomes a gap rather than a floor.
 */
export function dimValues(s: Pick<SegmentSummary, "dimAverages">, dims: string[]): (number | null)[] {
  const byId = new Map(s.dimAverages.map((d) => [d.dimId, d.avg]));
  return dims.map((d) => byId.get(d) ?? null);
}

export interface StackSpread {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Scored stacks behind the quartiles — the denominator, never the stack count. */
  n: number;
  /** Stacks present in the org that carry no measurement at all, so are absent from the quartiles. */
  unmeasured: number;
}

/** Linear-interpolated quantile over a SORTED ascending array. */
function quantile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const v = sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
  return Math.round(v * 10) / 10;
}

/**
 * The fleet's stack spread: five-number summary of the MEASURED stacks' overall scores. Returns null
 * below two measured stacks — one point is not a distribution, and drawing a degenerate box would
 * assert a shape the data has not got. Unmeasured stacks are counted, never plotted at 0.
 */
export function stackSpread(stacks: SegmentSummary[]): StackSpread | null {
  const measured = stacks.filter(isMeasured);
  const unmeasured = stacks.length - measured.length;
  if (measured.length < 2) return null;
  const sorted = measured.map((s) => s.avgOverall).sort((a, b) => a - b);
  return {
    min: sorted[0]!,
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1]!,
    n: measured.length,
    unmeasured,
  };
}

/**
 * Leaderboard order for the rail: measured stacks by score (descending), then the unmeasured ones by
 * name. Sorting on `avgOverall` alone put an unscanned stack last *because its sentinel was 0* — the
 * right position for the wrong reason, and a reason that becomes visibly wrong the moment the reader
 * asks why. Here the two groups are separated explicitly, so the tail reads "not judged", not "worst":
 * the unmeasured are OUTSIDE the ordering, not at the bottom of it.
 */
export function orderStacks(stacks: SegmentSummary[]): SegmentSummary[] {
  return [...stacks].sort((a, b) => {
    const am = a.avgOverall;
    const bm = b.avgOverall;
    if ((am === null) !== (bm === null)) return am === null ? 1 : -1;
    if (am === null || bm === null) return a.name.localeCompare(b.name);
    return bm - am;
  });
}
