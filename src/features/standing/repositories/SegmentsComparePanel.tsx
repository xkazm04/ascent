// The A-vs-B segment comparison — extracted out of SegmentsSection.tsx so that file stays under the
// 200-LOC cap (AGENTS.md).

import { SegmentComparePicker } from "./SegmentComparePicker";
import { postureText } from "./SegmentCard";
import { Card, Meter, SectionHeader, Tile, TILE_GRID, deltaHex, fmtDelta } from "@/components/org/shared/ui";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import type { SegmentComparison } from "@/lib/db";

/** A − B metric row: both values plus the signed, colored delta. */
function MetricRow({ label, a, b }: { label: string; a: number; b: number }) {
  const d = a - b;
  return (
    <div className="flex items-center gap-3 text-base">
      <span className="w-28 shrink-0 text-slate-400">{label}</span>
      <span className="w-10 text-right font-mono tabular-nums" style={{ color: scoreHex(a) }}>{a}</span>
      <span className="text-slate-600">·</span>
      <span className="w-10 text-right font-mono tabular-nums" style={{ color: scoreHex(b) }}>{b}</span>
      <span className="ml-auto font-mono text-sm" style={{ color: deltaHex(d) }}>{fmtDelta(d)}</span>
    </div>
  );
}

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
  return (
    <div>
      <SectionHeader
        title="Compare segments"
        description="Two slices side by side: e.g. platform is AI-Native while legacy is Experimental."
        right={<SegmentComparePicker options={options} a={aId} b={bId} />}
      />
      {!comparison ? (
        <p className="mt-4 text-base text-slate-500">Pick two segments to compare.</p>
      ) : (
        (() => {
          // repositories-segments #4: an unscanned side reduces to avgOverall 0 (a sentinel, not a
          // score), so "Δ +87" against a healthy A is comparison theater. Render "—" for the empty
          // side and suppress the delta tiles + metric/dimension rows until both sides have scans.
          const aEmpty = comparison.a.scannedCount === 0;
          const bEmpty = comparison.b.scannedCount === 0;
          const anyEmpty = aEmpty || bEmpty;
          return (
            <>
              <div className={`mt-4 ${TILE_GRID}`}>
                <Tile label={comparison.a.name} value={aEmpty ? "—" : comparison.a.avgOverall} sub={aEmpty ? `no scans yet · 0/${comparison.a.repoCount} scanned` : `${postureText(comparison.a.posture)} · ${comparison.a.scannedCount}/${comparison.a.repoCount} scanned`} color={aEmpty ? undefined : scoreHex(comparison.a.avgOverall)} />
                <Tile label={comparison.b.name} value={bEmpty ? "—" : comparison.b.avgOverall} sub={bEmpty ? `no scans yet · 0/${comparison.b.repoCount} scanned` : `${postureText(comparison.b.posture)} · ${comparison.b.scannedCount}/${comparison.b.repoCount} scanned`} color={bEmpty ? undefined : scoreHex(comparison.b.avgOverall)} />
                <Tile label="Overall Δ" value={anyEmpty ? "—" : fmtDelta(comparison.deltas.overall)} color={anyEmpty ? undefined : deltaHex(comparison.deltas.overall)} sub={anyEmpty ? "needs scans on both sides" : `${comparison.a.name} vs ${comparison.b.name}`} />
                <Tile label="Adopt / Rigor Δ" value={anyEmpty ? "—" : `${fmtDelta(comparison.deltas.adoption)} / ${fmtDelta(comparison.deltas.rigor)}`} sub={anyEmpty ? "needs scans on both sides" : "adoption · rigor"} />
              </div>

              {anyEmpty ? (
                <p className="mt-4 text-base text-slate-500">
                  {[aEmpty ? comparison.a.name : null, bEmpty ? comparison.b.name : null].filter(Boolean).join(" and ")} has no
                  scanned repos yet. Scan the segment above to make this comparison meaningful.
                </p>
              ) : (
                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                  {/* Headline metrics */}
                  <Card>
                    <SectionHeader
                      size="sm"
                      title="Headline metrics"
                      right={
                        <span className="font-mono text-sm text-slate-500">
                          <span className="text-slate-300">{comparison.a.name}</span> · <span className="text-slate-300">{comparison.b.name}</span> · Δ
                        </span>
                      }
                    />
                    <div className="mt-4 space-y-3">
                      <MetricRow label="Overall" a={comparison.a.avgOverall} b={comparison.b.avgOverall} />
                      <MetricRow label="AI Adoption" a={comparison.a.avgAdoption} b={comparison.b.avgAdoption} />
                      <MetricRow label="Engineering Rigor" a={comparison.a.avgRigor} b={comparison.b.avgRigor} />
                    </div>
                  </Card>

                  {/* Dimension comparison */}
                  <Card>
                    <SectionHeader size="sm" title="By dimension" />
                    <div className="mt-4 space-y-2">
                      {comparison.dimDeltas.map((d) => (
                        <div key={d.dimId} className="flex items-center gap-2 text-sm">
                          <span className="w-16 shrink-0 text-slate-400">{DIMENSION_SHORT[d.dimId as keyof typeof DIMENSION_SHORT] ?? d.dimId}</span>
                          <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(d.a) }}>{d.a}</span>
                          <Meter className="flex-1" size="sm" value={d.a} color={scoreHex(d.a)} />
                          <Meter className="flex-1" size="sm" value={d.b} color={scoreHex(d.b)} />
                          <span className="w-7 text-left font-mono tabular-nums" style={{ color: scoreHex(d.b) }}>{d.b}</span>
                          <span className="w-9 text-right font-mono" style={{ color: deltaHex(d.delta) }}>{fmtDelta(d.delta)}</span>
                        </div>
                      ))}
                      {comparison.dimDeltas.length === 0 && <p className="text-sm text-slate-500">Neither segment has a scanned repo yet.</p>}
                    </div>
                    <p className="mt-3 font-mono text-sm text-slate-600">
                      left bar · {comparison.a.name} · right bar · {comparison.b.name}
                    </p>
                  </Card>
                </div>
              )}
            </>
          );
        })()
      )}
    </div>
  );
}
