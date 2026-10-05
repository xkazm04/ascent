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
import { SegmentDistribution, SegmentDistributionRow } from "./SegmentDistribution";
import { SegmentGapLaggards } from "./SegmentGapLaggards";
import { dimensionPairs, distributionRows, headlinePairs, pairedStates, trailingSide } from "./segmentViz";
import { postureText } from "./SegmentCard";
import { Card, SectionHeader, Tile, TILE_GRID, deltaHex, fmtDelta } from "@/components/org/shared/ui";
import { Legend, WhyChip } from "@/components/org/viz";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import type { SegmentComparison } from "@/lib/db";
import { compareCountSub } from "./segmentCounts";

const SENTINEL_HINT =
  "A segment with no scanned repository has no score at all: there is nothing to average, so the average does not exist rather than being 0. That side is drawn as a gap and its delta withheld, because a difference against a missing number is comparison theatre.";

const shortDim = (dimId: string) => DIMENSION_SHORT[dimId as keyof typeof DIMENSION_SHORT] ?? dimId;

export function SegmentsComparePanel({
  options,
  aId,
  bId,
  comparison,
  taggedById = {},
  org,
  watched,
  schedulable = false,
}: {
  options: { id: string; name: string }[];
  aId: string;
  bId: string | null;
  comparison: SegmentComparison | null;
  /** listSegments tagged counts, keyed by segment id. Fleet (id null) has no tag universe. */
  taggedById?: Record<string, number>;
  org: string;
  /** The org's watch list — what POST /api/org/scan would actually scan. A laggard outside it gets the
   *  report link only, the same intersection SegmentActions states in its own label. */
  watched: ReadonlySet<string>;
  /** isAppConfigured(), threaded from the server section exactly as the leaderboard threads it. */
  schedulable?: boolean;
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
  // [overall, ...one per dimension] — the headline card draws the first, the dimension card the rest.
  const distRows = distributionRows(comparison, shortDim);
  const overallRow = distRows[0]!; // safe: distributionRows always emits the overall row first
  const dimRows = distRows.slice(1);
  const aName = comparison.a.name;
  const bName = comparison.b.name;
  const taggedOf = (id: string | null) => (id != null && taggedById[id] != null ? taggedById[id]! : null);
  const tileSub = (s: typeof comparison.a, score: number | null) =>
    compareCountSub({
      score,
      scannedCount: s.scannedCount,
      tagged: taggedOf(s.id),
      postureLine: postureText(s.posture),
    });

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
        {/* The same two sides as POPULATIONS: one mark per repo, the mean marked as a mean, and the n
            each side rests on printed — so a tight cluster and one repo dragging a mean of three can
            never read as the same slice (registry: peer-benchmarking). */}
        <SegmentDistribution className="mt-4 max-w-xl" rows={[overallRow]} title="Overall, per repo" />
        <Legend states={pairedStates(headline)} className="mt-3" />
      </Card>

      <div className={`mt-4 ${TILE_GRID}`}>
        <Tile
          label={aName}
          value={aScore === null ? "—" : aScore}
          sub={tileSub(comparison.a, aScore)}
          color={aScore === null ? undefined : scoreHex(aScore)}
        />
        <Tile
          label={bName}
          value={bScore === null ? "—" : bScore}
          sub={tileSub(comparison.b, bScore)}
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
        <SectionHeader size="sm" title="By dimension" description="Open a dimension to see the shape of each side and the repos behind the gap" />
        <SegmentDumbbell className="mt-2 max-w-xl" rows={dims} aName={aName} bName={bName} title="By dimension" />
        {/* A gap stops being a readout here: the trailing side's own repos, worst-first on THIS
            dimension, with the actions that already exist for them. `<details>` so the drill-down costs
            no client JS on a tab that is otherwise a server render. */}
        <div className="mt-3 max-w-xl divide-y divide-slate-800/70">
          {dimRows.map((row) => {
            const trailing = trailingSide(row);
            return (
              <details key={row.id} data-dim={row.id} className="py-2">
                <summary className="cursor-pointer type-body-sm text-slate-300 hover:text-white">
                  {`${row.label} · ${aName} ${row.a.mean ?? "—"} vs ${bName} ${row.b.mean ?? "—"}`}
                  {row.delta != null && <span className="ml-2 type-mono-sm" style={{ color: deltaHex(row.delta) }}>{fmtDelta(row.delta)}</span>}
                </summary>
                <div className="mt-2 space-y-3">
                  <SegmentDistributionRow row={row} />
                  {trailing && (
                    <SegmentGapLaggards org={org} side={trailing} metricLabel={row.label} watched={watched} schedulable={schedulable} />
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
