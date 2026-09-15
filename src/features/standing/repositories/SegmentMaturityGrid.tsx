// The segment strip's first sight: every slice on three axes, above the cards that detail them.
//
// docs/ORG-UX-REDESIGN.md §2.2. The strip's own reading — "which slice of the fleet is ahead, and on
// what" — was only obtainable by reading six cards and holding three numbers from each. The cards
// stay: they carry the per-segment scan and cadence controls, which a grid cannot.
//
// A segment nobody has scanned is HATCHED, not scored zero: `avgOverall` reduces to 0 for an
// unscanned slice, and that sentinel used to be painted through the score ramp on the card below
// (repositories-segments #4 fixed the card; this keeps the same promise in the overview).
//
// Server-safe: no hooks, no handlers.

import { Kicker } from "@/components/ui";
import { Legend, MatrixGrid, WhyChip } from "@/components/org/viz";
import type { SegmentSummary } from "@/lib/db";
import { SEGMENT_AXES, segmentMatrixRows, segmentMatrixStates } from "./segmentViz";

const SENTINEL_HINT =
  "A segment with no scanned repository is hatched here rather than scored: its averages reduce to 0, which is a sentinel and not a measurement, so no number is printed for it at all.";

export function SegmentMaturityGrid({ summaries, className = "" }: { summaries: SegmentSummary[]; className?: string }) {
  const rows = segmentMatrixRows(summaries);
  if (rows.length === 0) return null;
  return (
    <div className={`rounded-2xl border border-divider bg-surface/40 p-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <Kicker tone="muted">segments on three axes</Kicker>
        <WhyChip hint={SENTINEL_HINT} label="why a segment can be hatched" align="end" />
      </div>
      <MatrixGrid className="mt-2 max-w-lg" axes={[...SEGMENT_AXES]} rows={rows} title="Segment maturity" />
      <Legend states={segmentMatrixStates(rows)} className="mt-3" />
    </div>
  );
}
