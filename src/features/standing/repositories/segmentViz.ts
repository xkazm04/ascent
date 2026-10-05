// Segments, as shapes: the maturity strip's matrix and the A-vs-B comparison's paired rows.
//
// A segment comparison is two DISTRIBUTIONS of a fleet slice, and it was rendered as two columns of
// figures with a signed delta at the end of each — a shape stated as arithmetic
// (docs/ORG-UX-REDESIGN.md §2.2). The paired row (`headlinePairs`/`dimensionPairs`) fixed the
// arithmetic-as-shape half, but it is still two marks: a segment of 20 repos and a segment of 2 drew
// identically. The producer now returns the population it averaged (`SegmentSummary.points`,
// 2026-10-05), so `distributionRows` below draws the SHAPE — one mark per repo, the mean marked on the
// same track and labelled as a mean, with each side stating the n it rests on. (That is the registry's
// `peer-benchmarking` pair of rules: population-vs-scalar-ranking, so a mean and an item are never the
// same mark, and basis-disclosure, so a figure carries its n. A one-repo "mean" says so.)
//
// The load-bearing part is the null: a segment with ZERO scanned repos has no average at all. It used
// to reduce to `avgOverall: 0` — a sentinel, not a score (repositories-segments #4) — and this module
// recovered the absence by testing `scannedCount === 0`, a DIFFERENT field than the one it draws. The
// producer says it now (`SegmentSummary.avgOverall: number | null`, 2026-09-08), so the headline marks
// read their own nullness and the re-derivation is gone. Per-dimension rows used to re-derive the
// same void from `scannedCount` because `dimDeltas` coalesced an unscored dimension to 0; the
// producer now emits `number | null` there too, so those rows pass the values through.
//
// Pure: no React, no fetch. The kit types are `import type`.

import type { MatrixCell, MatrixRow, VizState } from "@/components/org/viz";
import type { SegmentComparison, SegmentSummary } from "@/lib/db";

export const SEGMENT_AXES = ["Overall", "Adopt", "Rigor"] as const;

/** One metric, on both sides. `null` = that side has no measurement for this metric. */
export interface PairedRow {
  id: string;
  label: string;
  a: number | null;
  b: number | null;
  /** Null whenever either side is null: a delta against a sentinel is comparison theatre. */
  delta: number | null;
}

/** The maturity strip's first sight: one row per segment, three measured axes or three hatches. */
export function segmentMatrixRows(summaries: readonly SegmentSummary[]): MatrixRow[] {
  return summaries.map((s) => {
    // Not `missing`: the repos exist and simply have not been scanned, which is "not judged" — and
    // never "scored zero", which is what painting the sentinel through the ramp used to imply.
    const cell = (v: number | null): MatrixCell => (v === null ? { state: "not-judged" } : { state: "measured", score: v });
    return {
      id: s.id ?? "fleet",
      label: s.name,
      cells: [cell(s.avgOverall), cell(s.avgAdoption), cell(s.avgRigor)],
    };
  });
}

function paired(id: string, label: string, a: number | null, b: number | null, delta: number | null): PairedRow {
  return { id, label, a, b, delta: a == null || b == null ? null : delta };
}

/** The three headline metrics as paired rows. */
export function headlinePairs(c: SegmentComparison): PairedRow[] {
  const A = c.a;
  const B = c.b;
  return [
    paired("overall", "Overall", A.avgOverall, B.avgOverall, c.deltas.overall),
    paired("adoption", "AI Adoption", A.avgAdoption, B.avgAdoption, c.deltas.adoption),
    paired("rigor", "Eng. Rigor", A.avgRigor, B.avgRigor, c.deltas.rigor),
  ];
}

/** One paired row per dimension, in the order `compareSegments` returned them. A side the
 *  producer never scored on that dimension arrives as `null` and stays a gap, never a zero. */
export function dimensionPairs(c: SegmentComparison, shortLabel: (dimId: string) => string): PairedRow[] {
  return c.dimDeltas.map((d) => paired(d.dimId, shortLabel(d.dimId), d.a, d.b, d.delta));
}

/** The states a set of paired rows actually contains — measured marks, plus voids where a side has none. */
export function pairedStates(rows: readonly PairedRow[]): VizState[] {
  const states: VizState[] = [];
  if (rows.some((r) => r.a != null || r.b != null)) states.push("measured");
  if (rows.some((r) => r.a == null || r.b == null)) states.push("missing");
  return states;
}

// ── Populations: one mark per repo, the mean marked on the same track ─────────────────────────────

/** One repo's value for one metric. Only repos the metric was actually MEASURED on get an item. */
export interface DistItem {
  fullName: string;
  value: number;
}

/** One side of a distribution row: the population, the mean, and the basis the mean rests on. */
export interface DistSide {
  name: string;
  /** One entry per repo MEASURED on this metric, in the producer's order. */
  items: DistItem[];
  /** Scanned repos of this side carrying no value for this metric — a gap to NAME, never a 0 to plot.
   *  Always empty on the overall row (a point exists only for a scanned repo, which has an overall). */
  unscored: string[];
  /** The producer's mean — not recomputed here, so the mark and the number cannot drift apart. */
  mean: number | null;
  /** `items.length`: what the mean rests on, and the number the side must print beside its mark. */
  n: number;
  /** The basis, said in words. The one place the n=0 and n=1 readings are decided. */
  basis: string;
}

export interface DistributionRow {
  /** "overall" for the headline row, else the dimension id. */
  id: string;
  label: string;
  a: DistSide;
  b: DistSide;
  delta: number | null;
}

/** n=0 is an absence, n=1 is one repo and not a population: a "mean" of one must not be read as a
 *  segment reading, so it says what it is instead of borrowing the word. */
function basisOf(n: number, unit: { one: string; many: string; none: string }): string {
  if (n === 0) return unit.none;
  if (n === 1) return `one ${unit.one}, not a segment mean`;
  return `mean of ${n} ${unit.many}`;
}

const OVERALL_UNIT = { one: "scanned repo", many: "scanned repos", none: "no scanned repository" };
const DIM_UNIT = { one: "scored repo", many: "scored repos", none: "not scored on this dimension" };

function side(
  name: string,
  points: readonly { fullName: string; overall: number; dims: { dimId: string; score: number }[] }[],
  mean: number | null,
  dimId: string | null,
): DistSide {
  const items: DistItem[] = [];
  const unscored: string[] = [];
  for (const p of points) {
    if (dimId === null) {
      items.push({ fullName: p.fullName, value: p.overall });
      continue;
    }
    // `find` then an explicit null test, never `?? 0`: a dimension the latest scan did not score is
    // absent from `dims`, and a measured 0 is a real grade that must still plot (0 is not nullish).
    const d = p.dims.find((x) => x.dimId === dimId);
    if (d) items.push({ fullName: p.fullName, value: d.score });
    else unscored.push(p.fullName);
  }
  return { name, items, unscored, mean, n: items.length, basis: basisOf(items.length, dimId === null ? OVERALL_UNIT : DIM_UNIT) };
}

/**
 * The comparison as two populations: the overall row first, then one row per dimension in the order
 * `compareSegments` returned them.
 *
 * The means are passed through from the producer rather than recomputed from `items`, so a side's mark
 * and its printed mean are the same number by construction — and a side whose mean is null (nothing
 * scanned) keeps the null while still being able to carry zero items.
 */
export function distributionRows(c: SegmentComparison, shortLabel: (dimId: string) => string): DistributionRow[] {
  const rowOf = (id: string, label: string, dimId: string | null, aMean: number | null, bMean: number | null, delta: number | null) => ({
    id,
    label,
    a: side(c.a.name, c.a.points, aMean, dimId),
    b: side(c.b.name, c.b.points, bMean, dimId),
    delta: aMean == null || bMean == null ? null : delta,
  });
  return [
    rowOf("overall", "Overall", null, c.a.avgOverall, c.b.avgOverall, c.deltas.overall),
    ...c.dimDeltas.map((d) => rowOf(d.dimId, shortLabel(d.dimId), d.dimId, d.a, d.b, d.delta)),
  ];
}

/** A side's repos ranked WORST-FIRST on the row's metric — the laggards that drag its mean. Ties break
 *  on fullName so the order is stable across renders. */
export function laggards(s: DistSide, limit?: number): DistItem[] {
  const sorted = [...s.items].sort((x, y) => x.value - y.value || x.fullName.localeCompare(y.fullName));
  return limit == null ? sorted : sorted.slice(0, limit);
}

/** Bound what a strip plots. A 200-repo segment would otherwise draw 200 overlapping marks, which is
 *  a smear rather than a shape; the tail is counted instead of drawn. Worst-first, so the marks kept
 *  are the ones the reader is looking for. */
export function capItems(s: DistSide, max: number): { shown: DistItem[]; hidden: number } {
  const sorted = laggards(s);
  return { shown: sorted.slice(0, max), hidden: Math.max(0, sorted.length - max) };
}

/** The side a gap is ABOUT: the lower mean, which is the population worth naming repos from. When only
 *  one side was measured there is no "trailing" — nothing was out-scored — so the measured side is
 *  returned (it is the only one with repos to rank) and a row with neither returns null. */
export function trailingSide(row: DistributionRow): DistSide | null {
  if (row.a.mean != null && row.b.mean != null) return row.a.mean <= row.b.mean ? row.a : row.b;
  if (row.a.items.length > 0 || row.a.unscored.length > 0) return row.a;
  if (row.b.items.length > 0 || row.b.unscored.length > 0) return row.b;
  return null;
}
