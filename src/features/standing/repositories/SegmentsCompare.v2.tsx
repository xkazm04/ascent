// Prism segment comparison. Headline figures stay paper. Each dimension is its own spectral line.
import { Caption, DimensionLine, Frame, Lede, Movement, SectionHead, StatStrip, StatTile, VoidMark, parseDimension } from "@/components/kit";
import type { SegmentComparison } from "@/lib/db";
import { dimShort } from "@/lib/ui";
import { compareCountSub } from "./segmentCounts";
import { dimensionPairs } from "./segmentViz";
import { postureText } from "./SegmentCard";
import { SegmentComparePickerV2 } from "./SegmentComparePicker.v2";

function signed(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : String(n);
}

function Delta({ value, basis }: { value: number | null; basis: string }) {
  if (value == null) return <VoidMark subject="Difference" />;
  if (value === 0) return <span className="tabular-nums text-white">0</span>;
  return <Movement delta={value} basis={basis} toneClass={() => "text-slate-200"} />;
}

export function SegmentsCompareV2({
  options,
  aId,
  bId,
  comparison,
  taggedById = {},
}: {
  options: { id: string; name: string }[];
  aId: string;
  bId: string | null;
  comparison: SegmentComparison | null;
  taggedById?: Record<string, number>;
}) {
  if (!comparison) {
    return (
      <Frame edge="top" pad="md" aria-label="Compare segments">
        <SectionHead title="Compare" named="segments" actions={<SegmentComparePickerV2 options={options} a={aId} b={bId} />} />
        <Lede className="mt-3">Pick two segments to compare.</Lede>
      </Frame>
    );
  }

  const aScore = comparison.a.avgOverall;
  const bScore = comparison.b.avgOverall;
  const aName = comparison.a.name;
  const bName = comparison.b.name;
  const taggedOf = (id: string | null) => (id != null && taggedById[id] != null ? taggedById[id]! : null);
  const tileSub = (s: typeof comparison.a, score: number | null) =>
    compareCountSub({ score, scannedCount: s.scannedCount, tagged: taggedOf(s.id), postureLine: postureText(s.posture) });
  const missing = [aScore === null ? aName : null, bScore === null ? bName : null].filter(Boolean);
  const dims = dimensionPairs(comparison, dimShort);

  return (
    <Frame edge="top" pad="md" aria-label="Compare segments">
      <SectionHead
        eyebrow="Comparison"
        title="Compare"
        named="segments"
        lede="A side with no scanned repository has no average. The difference is withheld, not printed as zero."
        actions={<SegmentComparePickerV2 options={options} a={aId} b={bId} />}
      />
      <StatStrip cols={4} className="mt-6">
        <StatTile label={aName} value={aScore === null ? <VoidMark subject={aName} /> : aScore} sub={tileSub(comparison.a, aScore)} />
        <StatTile label={bName} value={bScore === null ? <VoidMark subject={bName} /> : bScore} sub={tileSub(comparison.b, bScore)} />
        <StatTile label="Overall change" value={<Delta value={comparison.deltas.overall} basis={`${aName} versus ${bName}`} />} sub={comparison.deltas.overall === null ? "needs scans on both sides" : `${aName} vs ${bName}`} />
        <StatTile
          label="Adopt / rigor change"
          value={
            comparison.deltas.adoption === null || comparison.deltas.rigor === null ? (
              <VoidMark subject="Adopt and rigor change" />
            ) : (
              `${signed(comparison.deltas.adoption)} / ${signed(comparison.deltas.rigor)}`
            )
          }
          sub={comparison.deltas.adoption === null || comparison.deltas.rigor === null ? "needs scans on both sides" : "adoption, rigor"}
        />
      </StatStrip>
      {missing.length > 0 && (
        <Caption className="mt-4">
          {missing.join(" and ")} {missing.length > 1 ? "have" : "has"} no scanned repos yet. Scan the segment above to make this comparison meaningful.
        </Caption>
      )}
      <div className="mt-8 space-y-4">
        {dims.map((d) => {
          const n = parseDimension(d.id);
          if (n == null) {
            return (
              <Caption key={d.id}>
                {d.label}: {aName} {d.a == null ? "not measured" : d.a}, {bName} {d.b == null ? "not measured" : d.b}
              </Caption>
            );
          }
          return (
            <div key={d.id} className="space-y-1">
              <DimensionLine wide dimension={n} label={`${d.label}, ${aName}`} value={d.a == null ? null : d.a / 100} display={d.a == null ? "not measured" : String(d.a)} />
              <DimensionLine wide dimension={n} label={`${d.label}, ${bName}`} value={d.b == null ? null : d.b / 100} display={d.b == null ? "not measured" : String(d.b)} />
              <Caption>{d.delta == null ? "Difference not measured" : `Change ${signed(d.delta)}`}</Caption>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}
