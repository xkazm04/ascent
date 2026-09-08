// The A-vs-B segment comparison — extracted out of SegmentsSection.tsx so that file stays under the
// 200-LOC cap (AGENTS.md).
//
// /org redesign (docs/ORG-UX-REDESIGN.md §2): a comparison of two slices is a SHAPE, and this panel
// rendered it as two columns of figures with a delta at the end of each row, plus two meters per
// dimension whose lengths a reader had to compare by eye across a gap. Both are now paired rows on
// one shared axis (SegmentDumbbell), so "which slice leads, by how much, and where they agree" is
// read rather than computed.
//
// The empty-side rule is no longer enforced by hiding the comparison: an unscanned side ARRIVES as
// `null` from the producer (`SegmentSummary.avgOverall: number | null`, 2026-09-08 — `segmentViz.ts`
// used to recover it from `scannedCount`), the mark is simply not drawn, and the delta reads "—". The
// reader can still see WHICH metrics exist on the other side, which the suppressed version denied them.

import { SegmentComparePicker } from "./SegmentComparePicker";
import { SegmentDumbbell } from "./SegmentDumbbell";
import { dimensionPairs, headlinePairs, pairedStates } from "./segmentViz";
import { postureText } from "./SegmentCard";
import { Card, SectionHeader, Tile, TILE_GRID, deltaHex, fmtDelta } from "@/components/org/shared/ui";
import { Legend, WhyChip } from "@/components/org/viz";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import type { SegmentComparison } from "@/lib/db";

const SENTINEL_HINT =
  "A segment with no scanned repository has no score at all: there is nothing to average, so the average does not exist rather than being 0. That side is drawn as a gap and its delta withheld, because a difference against a missing number is comparison theatre.";

const shortDim = (dimId: string) => DIMENSION_SHORT[dimId as keyof typeof DIMENSION_SHORT] ?? dimId;

export function SegmentsComparePanel({
  options,
  aId,
  bId,
  comparison,
}: {
  options: { id: string; name: string }[];
  aId: string;
  bId: string | null;
  comparison: SegmentComparison | null;
}) {
  if (!comparison) {
    return (
      <div>
        <SectionHeader title="Compare segments" right={<SegmentComparePicker options={options} a={aId} b={bId} />} />
        <p className="mt-4 type-body text-slate-500">Pick two segments to compare.</p>
      </div>
    );
  }

  // Read off the averages themselves, not `scannedCount` one field over: a side with nothing scanned
  // has no average, and that is now what the type says.
  const aScore = comparison.a.avgOverall;
  const bScore = comparison.b.avgOverall;
  const dOverall = comparison.deltas.overall;
  const dAdoption = comparison.deltas.adoption;
  const dRigor = comparison.deltas.rigor;
  const headline = headlinePairs(comparison);
  const dims = dimensionPairs(comparison, shortDim);
  const aName = comparison.a.name;
  const bName = comparison.b.name;

  return (
    <div>
      <SectionHeader title="Compare segments" right={<SegmentComparePicker options={options} a={aId} b={bId} />} />

      {/* First sight: the two slices on one axis (§2.2). */}
      <Card className="mt-4">
        <SectionHeader
          size="sm"
          title="Headline metrics"
          right={<WhyChip hint={SENTINEL_HINT} label="why a side can be blank" align="end" />}
        />
        <SegmentDumbbell className="mt-2 max-w-xl" rows={headline} aName={aName} bName={bName} title="Headline metrics" />
        <Legend states={pairedStates(headline)} className="mt-3" />
      </Card>

      <div className={`mt-4 ${TILE_GRID}`}>
        <Tile
          label={aName}
          value={aScore === null ? "—" : aScore}
          sub={aScore === null ? `no scans yet · 0/${comparison.a.repoCount} scanned` : `${postureText(comparison.a.posture)} · ${comparison.a.scannedCount}/${comparison.a.repoCount} scanned`}
          color={aScore === null ? undefined : scoreHex(aScore)}
        />
        <Tile
          label={bName}
          value={bScore === null ? "—" : bScore}
          sub={bScore === null ? `no scans yet · 0/${comparison.b.repoCount} scanned` : `${postureText(comparison.b.posture)} · ${comparison.b.scannedCount}/${comparison.b.repoCount} scanned`}
          color={bScore === null ? undefined : scoreHex(bScore)}
        />
        <Tile
          label="Overall Δ"
          value={dOverall === null ? "—" : fmtDelta(dOverall)}
          color={dOverall === null ? undefined : deltaHex(dOverall)}
          sub={dOverall === null ? "needs scans on both sides" : `${aName} vs ${bName}`}
        />
        <Tile
          label="Adopt / Rigor Δ"
          value={dAdoption === null || dRigor === null ? "—" : `${fmtDelta(dAdoption)} / ${fmtDelta(dRigor)}`}
          sub={dAdoption === null || dRigor === null ? "needs scans on both sides" : "adoption · rigor"}
        />
      </div>

      {(aScore === null || bScore === null) && (
        // The remedy, in the degraded state where a reader needs it (§2.1 O) — and only there.
        <p className="mt-4 type-body text-slate-500">
          {[aScore === null ? aName : null, bScore === null ? bName : null].filter(Boolean).join(" and ")} has no scanned repos yet. Scan
          the segment above to make this comparison meaningful.
        </p>
      )}

      <Card className="mt-4">
        <SectionHeader size="sm" title="By dimension" />
        <SegmentDumbbell className="mt-2 max-w-xl" rows={dims} aName={aName} bName={bName} title="By dimension" />
      </Card>
    </div>
  );
}
