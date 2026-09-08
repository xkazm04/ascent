// Segments, as shapes: the maturity strip's matrix and the A-vs-B comparison's paired rows.
//
// A segment comparison is two DISTRIBUTIONS of a fleet slice, and it was rendered as two columns of
// figures with a signed delta at the end of each — a shape stated as arithmetic
// (docs/ORG-UX-REDESIGN.md §2.2). The available data is per-segment AVERAGES rather than per-repo
// values (`compareSegments` returns means), so the honest drawing of it is a paired row — A's mark,
// B's mark, the span between them — not a box plot the data cannot support. Said loudly here rather
// than quietly widening a shared query: a real distribution per segment needs `compareSegments` to
// return the per-repo scores it already reads, and that is `src/lib/db`'s call to make.
//
// The load-bearing part is the null: a segment with ZERO scanned repos reduces to `avgOverall: 0`,
// which is a sentinel and not a score (repositories-segments #4). Every value below is `null` in that
// case, so the mark is a void and `rendersValue` keeps a numeral off it — the panel used to protect
// that with a paragraph and by suppressing the whole comparison.
//
// Pure: no React, no fetch. The kit types are `import type`.

import type { MatrixCell, MatrixRow, VizState } from "@/components/org/viz";
import type { SegmentComparison, SegmentSummary } from "@/lib/db";

export const SEGMENT_AXES = ["Overall", "Adopt", "Rigor"] as const;

/** One metric, on both sides. `null` = that side has no scanned repo, so it has no value at all. */
export interface PairedRow {
  id: string;
  label: string;
  a: number | null;
  b: number | null;
  /** Null whenever either side is null: a delta against a sentinel is comparison theatre. */
  delta: number | null;
}

const value = (scanned: number, v: number): number | null => (scanned === 0 ? null : v);

/** The maturity strip's first sight: one row per segment, three measured axes or three hatches. */
export function segmentMatrixRows(summaries: readonly SegmentSummary[]): MatrixRow[] {
  return summaries.map((s) => {
    // Not `missing`: the repos exist and simply have not been scanned, which is "not judged" — and
    // never "scored zero", which is what painting the sentinel through the ramp used to imply.
    const cell = (v: number): MatrixCell => (s.scannedCount === 0 ? { state: "not-judged" } : { state: "measured", score: v });
    return {
      id: s.id ?? "fleet",
      label: s.name,
      cells: [cell(s.avgOverall), cell(s.avgAdoption), cell(s.avgRigor)],
    };
  });
}

/** Only the states these rows contain, in kit order — the `Legend` contract. */
export function segmentMatrixStates(rows: readonly MatrixRow[]): VizState[] {
  const present = new Set<VizState>(rows.flatMap((r) => r.cells.map((c) => c.state)));
  return (["measured", "not-judged"] as VizState[]).filter((s) => present.has(s));
}

function paired(id: string, label: string, a: number | null, b: number | null, delta: number): PairedRow {
  return { id, label, a, b, delta: a == null || b == null ? null : delta };
}

/** The three headline metrics as paired rows. */
export function headlinePairs(c: SegmentComparison): PairedRow[] {
  const A = c.a;
  const B = c.b;
  return [
    paired("overall", "Overall", value(A.scannedCount, A.avgOverall), value(B.scannedCount, B.avgOverall), c.deltas.overall),
    paired("adoption", "AI Adoption", value(A.scannedCount, A.avgAdoption), value(B.scannedCount, B.avgAdoption), c.deltas.adoption),
    paired("rigor", "Eng. Rigor", value(A.scannedCount, A.avgRigor), value(B.scannedCount, B.avgRigor), c.deltas.rigor),
  ];
}

/** One paired row per dimension, in the order `compareSegments` returned them. */
export function dimensionPairs(c: SegmentComparison, shortLabel: (dimId: string) => string): PairedRow[] {
  return c.dimDeltas.map((d) =>
    paired(d.dimId, shortLabel(d.dimId), value(c.a.scannedCount, d.a), value(c.b.scannedCount, d.b), d.delta),
  );
}

/** The states a set of paired rows actually contains — measured marks, plus voids where a side has none. */
export function pairedStates(rows: readonly PairedRow[]): VizState[] {
  const states: VizState[] = [];
  if (rows.some((r) => r.a != null || r.b != null)) states.push("measured");
  if (rows.some((r) => r.a == null || r.b == null)) states.push("missing");
  return states;
}
