// /org/[slug]/tech-stacks — the optional tech-stack comparison page (3b-P2). A per-stack rollup strip
// plus a side-by-side A-vs-B comparison (Frontend vs Backend·Python). Mirrors the Segments comparison
// page; reuses getOrgRollup's scoped averages via compareTechStacks. The org layout supplies the
// auth/DB guards. Stacks are auto-derived (no creation here) — when there are none, point to scanning.

import Link from "next/link";
import { TechStackComparePicker } from "@/components/org/TechStackComparePicker";
import { Card, Meter, SectionEmpty, SectionHeader, Tile, POSTURE_LABEL, deltaHex, fmtDelta } from "@/components/org/ui";
import { compareTechStacks, listTechStackGroups, listTechStackSummaries } from "@/lib/db";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function OrgTechStacks({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const [groups, summaries] = await Promise.all([
    listTechStackGroups(slug),
    listTechStackSummaries(slug).then((s) => s ?? []),
  ]);

  if (groups.length === 0) {
    return (
      <SectionEmpty>
        No tech stacks detected yet. Stacks are derived from each repo&apos;s manifests at scan time — scan some of this org&apos;s{" "}
        <Link href={`/org/${slug}/repositories`} className="text-accent hover:text-white">repositories</Link>, then this view groups them by Frontend / Backend·language / Mobile / Data·ML / Infra.
      </SectionEmpty>
    );
  }

  const options = groups.map((g) => ({ key: g.key, label: g.label }));
  const keys = new Set(options.map((o) => o.key));

  // Resolve the A/B selection from the URL, defaulting to the first two stacks (B = whole fleet when
  // there's only one stack to compare against the org baseline).
  const aParam = first(sp.a);
  const bParam = first(sp.b);
  const aKey = aParam && keys.has(aParam) ? aParam : options[0]!.key; // safe: groups non-empty above
  const bKey = bParam && keys.has(bParam) && bParam !== aKey ? bParam : options.find((o) => o.key !== aKey)?.key ?? null;

  const comparison = await compareTechStacks(slug, aKey, bKey);

  return (
    <div className="space-y-6">
      {/* Per-stack rollup strip */}
      <div>
        <SectionHeader
          title="Tech stacks"
          description="Per-stack maturity across the fleet — each auto-derived group rolled up from its repos' latest scans. Frontend security 72 vs Backend 65, all Python services, and so on."
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((s) => (
            <Card key={s.id ?? "fleet"}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-white">{s.name}</span>
                <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: scoreHex(s.avgOverall) }}>{s.avgOverall}</span>
              </div>
              <div className="mt-1 font-mono text-sm text-slate-500">
                {POSTURE_LABEL[s.posture] ?? s.posture} · {s.scannedCount}/{s.repoCount} scanned
              </div>
              <div className="mt-3 flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 text-slate-400">Adopt</span>
                <Meter className="flex-1" size="sm" value={s.avgAdoption} color={scoreHex(s.avgAdoption)} />
                <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(s.avgAdoption) }}>{s.avgAdoption}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 text-slate-400">Rigor</span>
                <Meter className="flex-1" size="sm" value={s.avgRigor} color={scoreHex(s.avgRigor)} />
                <span className="w-7 text-right font-mono tabular-nums" style={{ color: scoreHex(s.avgRigor) }}>{s.avgRigor}</span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div>
        <SectionHeader
          title="Compare stacks"
          description="Two stacks side by side — e.g. Frontend is AI-Native while Backend·Python is still Manual."
          right={<TechStackComparePicker options={options} a={aKey} b={bKey} />}
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
                  {comparison.dimDeltas.length === 0 && <p className="text-sm text-slate-500">Neither stack has a scanned repo yet.</p>}
                </div>
                <p className="mt-3 font-mono text-sm text-slate-600">
                  left bar · {comparison.a.name} · right bar · {comparison.b.name}
                </p>
              </Card>
            </div>
          </>
        ) : (
          <p className="mt-4 text-base text-slate-500">Pick two stacks to compare.</p>
        )}
      </div>
    </div>
  );
}

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
