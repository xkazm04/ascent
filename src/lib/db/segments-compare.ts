// The comparison half of src/lib/db/segments.ts, lifted out whole (AGENTS.md's src/lib/db/org.ts and
// src/lib/db/scans.ts pattern: a themed sub-module, with the original file kept as a thin re-export
// barrel so no call site changes). segments.ts was 636 lines and this card adds to it.
//
// Everything here is PURE — no Prisma, no await. The async orchestrators that feed it (one
// getOrgRollup plus the membership map) stay in segments.ts, which is what keeps the dependency
// one-way: segments.ts -> segments-compare.ts, never back.
//
// The shape change this module exists for: a side of a comparison now carries its `points` — the
// per-repo, per-dimension scores the reducer was already walking on its way to an average and then
// throwing away (segmentViz.ts said so out loud and escalated it here). A mean is a scalar; a segment
// is a population. The registry's `peer-benchmarking` technique population-vs-scalar-ranking is the
// rule being honoured: both sides must be the same kind of thing, the mean mark stays labelled a
// mean, and every side states the n it rests on (basis-disclosure), which is why `points` travels
// beside the averages rather than replacing them.

import { postureFor } from "@/lib/maturity/model";
import { roundedMean } from "@/lib/db/org-shared";
import type { OrgRepoRow } from "@/lib/db/org";
import type { SegmentDrift, SegmentRule } from "@/lib/org/segmentRule";

/**
 * One scanned repo of a side, as the comparison surfaces it: the identity the reader can act on plus
 * the scores the side's means were reduced from.
 *
 * Only SCANNED repos appear. A tagged-but-unscanned repo has no point, because it has no value —
 * plotting it anywhere (least of all at 0) is the sentinel this layer spent a release removing.
 * `dims` carries only the dimensions the latest scan actually scored, so a dimension a repo was never
 * graded on is ABSENT rather than zero and the consumer can render it as "not scored".
 *
 * Wire-safe by construction: strings and numbers only, no Date (src/lib/db/wire-safe-dates.test.ts).
 */
export interface SegmentPoint {
  fullName: string;
  overall: number;
  dims: { dimId: string; score: number }[];
}

/** One side of a comparison — a segment's (or the whole fleet's) headline maturity shape. */
export interface SegmentSummary {
  id: string | null; // null = the whole fleet (the comparison baseline)
  name: string;
  /** Repos in the FLEET-ROLLUP universe (watched OR has-scans) that belong to this segment — NOT every
   *  tagged repo. (G4-08) `SegmentRow.repoCount` (listSegments) counts ALL tagged repos regardless of
   *  watch/scan status, so the two can legitimately disagree for a segment with
   *  tagged-but-unwatched/unscanned repos. Every UI rendering this repoCount must read it as "repos
   *  scored in this rollup", not "repos tagged into this segment". */
  repoCount: number;
  scannedCount: number;
  /** Mean latest overall score over this scope's SCANNED repos — **null when it has none**, which a
   *  segment can genuinely be (every tagged repo watched but never scanned, or the scope is empty).
   *  Same contract as {@link OrgRollup.avgOverall}, which is where the scoped variant reads it from. */
  avgOverall: number | null;
  avgAdoption: number | null;
  avgRigor: number | null;
  /**
   * Posture id derived from avg adoption × rigor — **null when either input is**, because a
   * classification computed from two absences is worse than a wrong number: it is a fabricated
   * CATEGORICAL. `postureFor(0, 0)` returns a real posture ("dormant"/whatever the model floors to)
   * and every surface renders it as a label with a colour, indistinguishable from a segment Ascent
   * actually looked at and classified. A segment with no scanned repo has no posture.
   */
  posture: string | null;
  dimAverages: { dimId: string; avg: number }[];
  /**
   * The population behind the averages above, one entry per SCANNED repo — the distribution the
   * means were computed from, kept instead of discarded.
   *
   * `scannedCount === points.length` by construction, and `avgOverall` is `roundedMean` of
   * `points.map(p => p.overall)`: the mean and the marks are the same arithmetic, which is what lets a
   * surface draw both without the two readings being able to disagree. Order is the rollup's
   * (fullName-ascending); any ranking is the consumer's to do.
   */
  points: SegmentPoint[];
  /** The segment's DECLARED membership, or null for a hand-kept list (and always null for the whole-fleet
   *  baseline and for auto tech-stack groups, which are derived, not declared). */
  rule: SegmentRule | null;
  /** How far the tagged set is from the declaration: how many taggable repos match but are not tagged,
   *  and how many RULE-OWNED rows no longer match. **null when there is no rule** — "undeclared" and
   *  "declared and in sync" are different states and a reader must be able to tell them apart. */
  drift: { toAdd: number; toRemove: number } | null;
}

export interface SegmentComparison {
  a: SegmentSummary;
  b: SegmentSummary;
  /** a − b on the headline metrics — each **null when either side's average is**, because a delta
   *  against a scope nobody scanned is not a delta. (`a.avgOverall` alone is not enough to tell:
   *  a comparison needs both ends.) */
  deltas: { overall: number | null; adoption: number | null; rigor: number | null };
  /** Per-dimension a/b/delta over the union of dimensions either side is scored on.
   *  A side with no average for that dimension is **null**, never 0 — absence is not a floor.
   *  `delta` is null when either end is, same rule as the headline deltas. */
  dimDeltas: { dimId: string; a: number | null; b: number | null; delta: number | null }[];
}

/**
 * The posture a scope's two axis means classify to — **null when either mean does not exist**.
 *
 * This is the one site where the mean-of-nothing bug produced something worse than a wrong number.
 * `postureFor` maps (adoption, rigor) onto a named quadrant, so feeding it the old `roundedMean`'s
 * two sentinel zeros handed an un-scanned segment a real posture id, which the Segments strip and the
 * comparison view then drew as a labelled, coloured classification — a judgement about a scope Ascent
 * never looked at. A fabricated numeral at least sits next to a `scannedCount: 0` that contradicts it;
 * a fabricated CATEGORY reads as a finding.
 */
const postureOf = (adoption: number | null, rigor: number | null): string | null =>
  adoption === null || rigor === null ? null : postureFor(adoption, rigor).id;

/** `a − b`, but only when BOTH ends were measured. A subtraction needs two numbers; substituting a 0
 *  for the missing one silently reports the other side's whole score as the gap between them. */
const subtractMeasured = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);

/** Pure: diff two segment summaries into headline + per-dimension deltas (a − b). Unit-tested. */
export function buildSegmentComparison(a: SegmentSummary, b: SegmentSummary): SegmentComparison {
  const aDim = new Map(a.dimAverages.map((d) => [d.dimId, d.avg]));
  const bDim = new Map(b.dimAverages.map((d) => [d.dimId, d.avg]));
  const dimIds = [...new Set([...aDim.keys(), ...bDim.keys()])].sort();
  return {
    a,
    b,
    deltas: {
      overall: subtractMeasured(a.avgOverall, b.avgOverall),
      adoption: subtractMeasured(a.avgAdoption, b.avgAdoption),
      rigor: subtractMeasured(a.avgRigor, b.avgRigor),
    },
    dimDeltas: dimIds.map((dimId) => {
      // `?? null`, not `?? 0`: Map.get is undefined when the side never scored this
      // dimension, and a measured 0 is a real grade that must survive (0 is not nullish).
      const av = aDim.get(dimId) ?? null;
      const bv = bDim.get(dimId) ?? null;
      return { dimId, a: av, b: bv, delta: subtractMeasured(av, bv) };
    }),
  };
}

/**
 * Reduce an in-memory set of a scope's repos (already filtered out of ONE fleet rollup) to its
 * headline maturity summary AND the population behind it. The repo set must be the fleet rollup's
 * rows (`watched OR has-scans`) filtered by the scope's membership, which is exactly what a scoped
 * getOrgRollup would return, so every scope's numbers are the same arithmetic over the same universe.
 *
 * Shared by every surface that fans out over a scope collection — listSegmentSummaries (custom
 * segments), compareSegments (the A/B pair) and listTechStackSummaries (auto tech groups,
 * tech-groups.ts). `scope.id` is the summary's id verbatim: a segment id for segments, the stable
 * stack KEY for tech groups (null = whole fleet).
 */
export function summarizeScopedRepos(
  scope: { id: string | null; name: string; rule?: SegmentRule | null; drift?: SegmentDrift | null },
  repos: OrgRepoRow[],
): SegmentSummary {
  const scanned = repos.filter((r) => r.latest);
  const dimSum: Record<string, { sum: number; n: number }> = {};
  for (const r of scanned)
    for (const d of r.latest!.dims) {
      const entry = (dimSum[d.dimId] = dimSum[d.dimId] || { sum: 0, n: 0 });
      entry.sum += d.score;
      entry.n += 1;
    }
  const dimAverages = Object.keys(dimSum)
    .sort()
    .map((dimId) => {
      const entry = dimSum[dimId]!; // safe: dimId comes from Object.keys(dimSum)
      return { dimId, avg: Math.round(entry.sum / entry.n) };
    });
  const avgAdoption = roundedMean(scanned.map((r) => r.latest!.adoption));
  const avgRigor = roundedMean(scanned.map((r) => r.latest!.rigor));
  return {
    id: scope.id,
    name: scope.name,
    repoCount: repos.length,
    scannedCount: scanned.length,
    avgOverall: roundedMean(scanned.map((r) => r.latest!.overall)),
    avgAdoption,
    avgRigor,
    posture: postureOf(avgAdoption, avgRigor),
    dimAverages,
    // The same rows the averages above were reduced from, kept. Only the four fields a consumer can
    // act on travel: a point is an identity plus its scores, never a copy of the rollup row.
    points: scanned.map((r) => ({
      fullName: r.fullName,
      overall: r.latest!.overall,
      dims: r.latest!.dims.map((d) => ({ dimId: d.dimId, score: d.score })),
    })),
    rule: scope.rule ?? null,
    // Counts, not lists: the card only ever renders "N repos match and are not tagged", and a wire row
    // that carried the fullNames would grow with the fleet for no reader.
    drift: scope.drift ? { toAdd: scope.drift.toAdd.length, toRemove: scope.drift.toRemove.length } : null,
  };
}

/** A side of a comparison, named: `members` absent (or null) means the WHOLE FLEET, not an empty
 *  segment — the two are different scopes and conflating them is how a baseline reads as unscanned. */
export interface CompareScope {
  id: string | null;
  name: string;
  members?: ReadonlySet<string> | null;
}

/**
 * Both sides of a comparison, reduced out of ONE fleet rollup's rows.
 *
 * This replaced a pair of scoped `getOrgRollup` calls (summarizeSegment/summarizeScopedRollup, deleted
 * 2026-10-05). Each of those re-ran the fleet query with a `segments.some.segmentId` filter, and
 * getOrgRollup's own header documents that a nested `take` does not bound the transfer, so "the org's
 * ENTIRE scan history crosses the wire" — three times for one screen, on a page that had already
 * fetched the unscoped rollup for its per-segment strip. Partitioning the one rollup in memory is the
 * same move tech-groups.ts made for stacks on 2026-08-19 (its summarizeTechStack went with it).
 */
export function compareScopes(repos: OrgRepoRow[], a: CompareScope, b: CompareScope): SegmentComparison {
  const side = (s: CompareScope) =>
    summarizeScopedRepos({ id: s.id, name: s.name }, s.members ? repos.filter((r) => s.members!.has(r.fullName)) : repos);
  return buildSegmentComparison(side(a), side(b));
}

/**
 * Resolve the A/B selection from two caller-supplied ids against the segments that actually exist.
 *
 * Both Segments views computed this inline and identically (`SegmentsSection.tsx`, `.v2.tsx`), which
 * is why it moved here: the selection decides which rollup slice is drawn, so it belongs beside the
 * producer that slices it and is testable without rendering a page.
 *
 * `exact` is the compareSegments contract: an `a` that is not a segment of the org resolves to null
 * (the caller gets "no comparison") rather than silently defaulting to the first segment, because a
 * caller-supplied id that quietly becomes a different id is a comparison of something nobody asked
 * for. The view contract (default) is the opposite on purpose: a missing or stale `?a=` falls back to
 * the first two segments so the tab has something to show.
 */
export function resolveComparePair(
  options: readonly { id: string }[],
  a: string | null | undefined,
  b: string | null | undefined,
  opts?: { exact?: boolean },
): { aId: string | null; bId: string | null } {
  const has = (id: string | null | undefined): id is string => id != null && options.some((o) => o.id === id);
  const aId = has(a) ? a : opts?.exact ? null : options[0]?.id ?? null;
  if (aId === null) return { aId: null, bId: null };
  if (has(b) && b !== aId) return { aId, bId: b };
  // b unset / unknown / equal to a. Exact mode leaves it null — "versus the whole fleet", which is
  // what compareSegments has always meant by a null bId. The view picks the next segment instead.
  return { aId, bId: opts?.exact ? null : options.find((o) => o.id !== aId)?.id ?? null };
}
