import { Card, Meter, SectionHeader, Tile, POSTURE_LABEL, deltaHex, fmtDelta } from "@/components/org/ui";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import type { SegmentComparison } from "@/lib/db";

/** Pull the first value of a (possibly repeated) searchParam — the A/B selection arrives as
 *  `string | string[] | undefined`. Shared by the segments + tech-stacks comparison pages. */
export const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Human posture label with a raw-id fallback. Deliberately the lookup-then-`?? raw` form (NOT the
// shared postureLabel(), which title-cases an unknown id) so the existing rendering is preserved
// exactly — the data layer only ever yields known posture ids, so the branches agree in practice.
const postureText = (posture: string) => POSTURE_LABEL[posture] ?? posture;

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

/**
 * The side-by-side A-vs-B comparison surface shared by the org Segments and Tech-stacks pages: a
 * 4-Tile headline grid (A / B / Overall Δ / Adopt-Rigor Δ), a "Headline metrics" card with three
 * MetricRows, and a "By dimension" meter card — or a "pick two" prompt when no pair is selected.
 * Both pages build the same `SegmentComparison` shape and render identical markup/classes here; only
 * the noun (segment / stack), woven into the two empty-state strings, varies.
 */
export function SegmentComparisonView({
  comparison,
  noun,
}: {
  comparison: SegmentComparison | null;
  noun: "segment" | "stack";
}) {
  if (!comparison) {
    return <p className="mt-4 text-base text-slate-500">Pick two {noun}s to compare.</p>;
  }
  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={comparison.a.name} value={comparison.a.avgOverall} sub={`${postureText(comparison.a.posture)} · ${comparison.a.scannedCount}/${comparison.a.repoCount} scanned`} color={scoreHex(comparison.a.avgOverall)} />
        <Tile label={comparison.b.name} value={comparison.b.avgOverall} sub={`${postureText(comparison.b.posture)} · ${comparison.b.scannedCount}/${comparison.b.repoCount} scanned`} color={scoreHex(comparison.b.avgOverall)} />
        <Tile label="Overall Δ" value={fmtDelta(comparison.deltas.overall)} color={deltaHex(comparison.deltas.overall)} sub={`${comparison.a.name} vs ${comparison.b.name}`} />
        <Tile label="Adopt / Rigor Δ" value={`${fmtDelta(comparison.deltas.adoption)} / ${fmtDelta(comparison.deltas.rigor)}`} sub="adoption · rigor" />
      </div>

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
            {comparison.dimDeltas.length === 0 && <p className="text-sm text-slate-500">Neither {noun} has a scanned repo yet.</p>}
          </div>
          <p className="mt-3 font-mono text-sm text-slate-600">
            left bar · {comparison.a.name} · right bar · {comparison.b.name}
          </p>
        </Card>
      </div>
    </>
  );
}
