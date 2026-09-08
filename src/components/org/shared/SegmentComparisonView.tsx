import { Card, Meter, SectionHeader, Tile, POSTURE_LABEL, deltaHex, fmtDelta } from "@/components/org/shared/ui";
import { dimShort, scoreHex } from "@/lib/ui";
import type { SegmentComparison } from "@/lib/db";

/** Pull the first value of a (possibly repeated) searchParam — the A/B selection arrives as
 *  `string | string[] | undefined`. Shared by the segments + tech-stacks comparison pages. */
export const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Human posture label with a raw-id fallback. Deliberately the lookup-then-`?? raw` form (NOT the
// shared postureLabel(), which title-cases an unknown id) so the existing rendering is preserved
// exactly — the data layer only ever yields known posture ids, so the branches agree in practice.
// A NULL posture is a scope with no scanned repo: `postureFor` is no longer fed two sentinel zeros to
// manufacture a quadrant for it (see `postureOf` in src/lib/db/segments.ts), so there is nothing to
// label and the tile says so instead of naming a classification nobody made.
const postureText = (posture: string | null) => (posture === null ? "Not classified" : POSTURE_LABEL[posture] ?? posture);

/** The em dash every surface in this repo prints for "no measurement" — the same glyph `fmtNum`
 *  (@/components/org/viz) and the org header chip land on. Never a 0: `scoreHex(0)` is alarm red. */
const NO_MEASURE = "—";

/** A score's ink, or the tile/row's default ink when there is no score to colour. */
const scoreInk = (v: number | null) => (v === null ? undefined : scoreHex(v));

/** An arrowed delta, or the no-measurement glyph when one of its two ends does not exist. */
const deltaText = (d: number | null) => (d === null ? NO_MEASURE : fmtDelta(d));

/** A − B metric row: both values plus the signed, colored delta. Any of the three may be absent —
 *  an unscanned scope has no average, and a delta needs a number on both sides. */
function MetricRow({ label, a, b }: { label: string; a: number | null; b: number | null }) {
  const d = a === null || b === null ? null : a - b;
  return (
    <div className="flex items-center gap-3 type-body">
      <span className="w-28 shrink-0 text-slate-400">{label}</span>
      <span className="w-10 text-right font-mono tabular-nums" style={{ color: scoreInk(a) }}>{a ?? NO_MEASURE}</span>
      <span className="text-slate-600">·</span>
      <span className="w-10 text-right font-mono tabular-nums" style={{ color: scoreInk(b) }}>{b ?? NO_MEASURE}</span>
      <span className="ml-auto type-mono-sm" style={{ color: d === null ? undefined : deltaHex(d) }}>
        {d === null ? NO_MEASURE : fmtDelta(d)}
      </span>
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
    return <p className="mt-4 type-body text-slate-500">Pick two {noun}s to compare.</p>;
  }
  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={comparison.a.name} value={comparison.a.avgOverall ?? NO_MEASURE} sub={`${postureText(comparison.a.posture)} · ${comparison.a.scannedCount}/${comparison.a.repoCount} scanned`} color={scoreInk(comparison.a.avgOverall)} />
        <Tile label={comparison.b.name} value={comparison.b.avgOverall ?? NO_MEASURE} sub={`${postureText(comparison.b.posture)} · ${comparison.b.scannedCount}/${comparison.b.repoCount} scanned`} color={scoreInk(comparison.b.avgOverall)} />
        <Tile label="Overall Δ" value={deltaText(comparison.deltas.overall)} color={comparison.deltas.overall === null ? undefined : deltaHex(comparison.deltas.overall)} sub={`${comparison.a.name} vs ${comparison.b.name}`} />
        <Tile label="Adopt / Rigor Δ" value={`${deltaText(comparison.deltas.adoption)} / ${deltaText(comparison.deltas.rigor)}`} sub="adoption · rigor" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Headline metrics */}
        <Card>
          <SectionHeader
            size="sm"
            title="Headline metrics"
            right={
              <span className="type-mono-sm text-slate-500">
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
              <div key={d.dimId} className="flex items-center gap-2 type-body-sm">
                <span className="w-16 shrink-0 text-slate-400">{dimShort(d.dimId)}</span>
                <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(d.a) }}>{d.a}</span>
                <Meter className="flex-1" size="sm" value={d.a} color={scoreHex(d.a)} />
                <Meter className="flex-1" size="sm" value={d.b} color={scoreHex(d.b)} />
                <span className="w-7 text-left font-mono tabular-nums" style={{ color: scoreHex(d.b) }}>{d.b}</span>
                <span className="w-9 text-right font-mono" style={{ color: deltaHex(d.delta) }}>{fmtDelta(d.delta)}</span>
              </div>
            ))}
            {comparison.dimDeltas.length === 0 && <p className="type-body-sm text-slate-500">Neither {noun} has a scanned repo yet.</p>}
          </div>
          <p className="mt-3 type-mono-sm text-slate-600">
            left bar · {comparison.a.name} · right bar · {comparison.b.name}
          </p>
        </Card>
      </div>
    </>
  );
}
