import Link from "next/link";
import { SegmentComparePicker } from "@/components/org/SegmentComparePicker";
import { Card, Meter, SectionEmpty, SectionHeader, Tile, POSTURE_LABEL, deltaHex, fmtDelta } from "@/components/org/ui";
import { compareSegments, listSegmentSummaries } from "@/lib/db";
import { levelForScore } from "@/lib/maturity/model";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import type { SegmentSummary } from "@/lib/db";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** One segment's headline standing — the per-segment rollup card in the overview strip. */
function SegmentCard({ s }: { s: SegmentSummary }) {
  const level = levelForScore(s.avgOverall);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-white">{s.name}</span>
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">{POSTURE_LABEL[s.posture] ?? s.posture}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-bold tabular-nums" style={{ color: scoreHex(s.avgOverall) }}>
          {s.avgOverall}
        </span>
        <span className="font-mono text-sm text-slate-500">{level.id} · {level.name}</span>
      </div>
      <div className="mt-2 flex gap-4 font-mono text-sm text-slate-400">
        <span>adopt {s.avgAdoption}</span>
        <span>rigor {s.avgRigor}</span>
      </div>
      <div className="mt-1 font-mono text-sm text-slate-600">{s.scannedCount}/{s.repoCount} scanned</div>
    </div>
  );
}

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

export default async function OrgSegments({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const summaries = (await listSegmentSummaries(slug)) ?? [];
  if (summaries.length === 0) {
    return (
      <SectionEmpty>
        No segments yet. Create named slices of the fleet (platform, mobile, legacy…) and tag repos into them on the{" "}
        <Link href={`/org/${slug}/repositories`} className="text-accent hover:text-white">
          Repositories
        </Link>{" "}
        tab, then compare them side by side here.
      </SectionEmpty>
    );
  }

  const options = summaries.filter((s) => s.id).map((s) => ({ id: s.id as string, name: s.name }));
  const ids = new Set(options.map((o) => o.id));

  // Resolve the A/B selection from the URL, defaulting to the first two segments (B = whole fleet
  // when there's only one segment to compare against the org baseline).
  const aParam = first(sp.a);
  const bParam = first(sp.b);
  const aId = aParam && ids.has(aParam) ? aParam : options[0].id;
  const bId = bParam && ids.has(bParam) && bParam !== aId ? bParam : options.find((o) => o.id !== aId)?.id ?? null;

  const comparison = await compareSegments(slug, aId, bId);

  return (
    <div className="space-y-6">
      {/* Per-segment rollup strip */}
      <div>
        <SectionHeader
          title="Segments"
          description="Per-segment maturity across the fleet — each slice rolled up from its tagged repos' latest scans."
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((s) => (
            <SegmentCard key={s.id ?? "fleet"} s={s} />
          ))}
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div>
        <SectionHeader
          title="Compare segments"
          description="Two slices side by side — e.g. platform is AI-Native while legacy is Experimental."
          right={<SegmentComparePicker options={options} a={aId} b={bId} />}
        />
        {comparison ? (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label={comparison.a.name} value={comparison.a.avgOverall} sub={`${POSTURE_LABEL[comparison.a.posture] ?? comparison.a.posture} · ${comparison.a.scannedCount}/${comparison.a.repoCount} scanned`} color={scoreHex(comparison.a.avgOverall)} />
              <Tile label={comparison.b.name} value={comparison.b.avgOverall} sub={`${POSTURE_LABEL[comparison.b.posture] ?? comparison.b.posture} · ${comparison.b.scannedCount}/${comparison.b.repoCount} scanned`} color={scoreHex(comparison.b.avgOverall)} />
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
                  {comparison.dimDeltas.length === 0 && <p className="text-sm text-slate-500">Neither segment has a scanned repo yet.</p>}
                </div>
                <p className="mt-3 font-mono text-sm text-slate-600">
                  left bar · {comparison.a.name} · right bar · {comparison.b.name}
                </p>
              </Card>
            </div>
          </>
        ) : (
          <p className="mt-4 text-base text-slate-500">Pick two segments to compare.</p>
        )}
      </div>
    </div>
  );
}
