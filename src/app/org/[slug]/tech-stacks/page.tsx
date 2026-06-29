// /org/[slug]/tech-stacks — the optional tech-stack comparison page (3b-P2). A per-stack rollup strip
// plus a side-by-side A-vs-B comparison (Frontend vs Backend·Python). Mirrors the Segments comparison
// page; reuses getOrgRollup's scoped averages via compareTechStacks. The org layout supplies the
// auth/DB guards. Stacks are auto-derived (no creation here) — when there are none, point to scanning.

import Link from "next/link";
import { TechStackComparePicker } from "@/components/org/TechStackComparePicker";
import { Card, Meter, SectionEmpty, SectionHeader, POSTURE_LABEL } from "@/components/org/ui";
import { SegmentComparisonView, first } from "@/components/org/SegmentComparisonView";
import { compareTechStacks, listTechStackGroups, listTechStackSummaries } from "@/lib/db";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

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
        <SegmentComparisonView comparison={comparison} noun="stack" />
      </div>
    </div>
  );
}
