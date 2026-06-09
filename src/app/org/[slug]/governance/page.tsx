// The "Governance" tab (Direction #4 phase 1) — the org maturity gate as policy-as-code, evaluated
// across the whole fleet: pass-rate, where repos fail, the worst offenders, and the exact CI snippet
// that enforces the SAME policy in pipelines. Assembled from the rollup + @/lib/scoring/gate (no re-scan).

import { buildGovernanceOverview, governanceMarkdown, type GovernanceOverview } from "@/lib/org/governance";
import { Card, InlineEmpty, Meter, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { CopyForLlm } from "@/components/CopyForLlm";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

const REASONS = [
  { key: "level", label: "Below required level" },
  { key: "dimension", label: "A dimension below floor" },
  { key: "posture", label: "Ungoverned posture" },
  { key: "overall", label: "Below overall score" },
] as const;

function ciSnippet(g: GovernanceOverview): string {
  return ["- uses: <owner>/ascent@v1", "  with:", "    ascent-url: ${{ vars.ASCENT_URL }}", ...g.ciWith.map((w) => `    ${w}`)].join("\n");
}

export default async function OrgGovernance({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = await buildGovernanceOverview(slug);

  if (!g) {
    return (
      <SectionEmpty>
        No scanned repositories yet — scan some of this org&apos;s repositories to evaluate the fleet against the governance gate.
      </SectionEmpty>
    );
  }

  const md = governanceMarkdown(g);
  const snippet = ciSnippet(g);
  const passColor = scoreHex(g.passRate);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title="Governance"
          description="One maturity gate, applied as policy-as-code to every repo in the fleet. See who clears the bar, where the rest fall short, and copy the snippet that enforces the exact same gate in CI."
        />
        <CopyForLlm text={md} label="Copy governance brief for LLM" />
      </div>

      <div className={TILE_GRID}>
        <Tile label="Gate pass rate" value={`${g.passRate}%`} color={passColor} sub={`${g.passing}/${g.scanned} repos`} />
        <Tile label="Passing" value={String(g.passing)} color="#16a34a" sub="clear the gate" />
        <Tile label="Failing" value={String(g.failing)} color={g.failing ? "#ef4444" : "#16a34a"} sub="below the bar" />
        <Tile label="Repos scanned" value={String(g.scanned)} sub="in the fleet" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader size="sm" title="Active policy" description="The bar every repo is held to — change it once, enforce it everywhere." />
          <ul className="mt-3 space-y-1.5">
            {g.policyText.map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm text-slate-300">
                <span aria-hidden className="mt-0.5 text-accent">▸</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <SectionHeader size="sm" title="Where the fleet fails" description="Repos failing each gate condition (counted once per repo)." />
          {g.failing === 0 ? (
            <InlineEmpty>Every scanned repo clears the gate.</InlineEmpty>
          ) : (
            <div className="mt-3 space-y-2">
              {REASONS.map((r) => {
                const n = g.byReason[r.key];
                const pct = g.scanned ? Math.round((n / g.scanned) * 100) : 0;
                return (
                  <div key={r.key} className="flex items-center gap-3 text-sm">
                    <span className="w-44 shrink-0 text-slate-400">{r.label}</span>
                    <Meter className="flex-1" value={pct} color={n ? "#ef4444" : "#334155"} />
                    <span className="w-16 shrink-0 text-right font-mono text-slate-300">{n} repo{n === 1 ? "" : "s"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionHeader size="sm" title="Failing repos" description="Worst first — the specific conditions each repo misses." />
        {g.failures.length === 0 ? (
          <InlineEmpty>No repos fail the gate. 🎉</InlineEmpty>
        ) : (
          <div className="mt-3 space-y-3">
            {g.failures.map((f) => (
              <div key={f.fullName} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm text-slate-200">{f.fullName}</span>
                  <span className="font-mono text-xs text-slate-500">
                    {f.level} · overall <span style={{ color: scoreHex(f.overall) }}>{f.overall}</span>
                  </span>
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {f.reasons.map((reason, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-400">
                      <span aria-hidden className="select-none text-red-400/70">✕</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeader size="sm" title="Enforce in CI" description="The dashboard gate and your pipeline run the identical policy — no drift." />
          <CopyForLlm text={snippet} label="Copy CI snippet" />
        </div>
        <div className="mt-3 space-y-3">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-slate-500">Gate API</div>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs text-slate-300">
              GET &lt;ASCENT_URL&gt;/api/gate/&lt;owner&gt;/&lt;repo&gt;?{g.gateQuery}
              {"\n"}<span className="text-slate-500"># 200 = pass · 422 = fail (curl --fail exits non-zero)</span>
            </pre>
          </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-slate-500">GitHub Action</div>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs text-slate-300">{snippet}</pre>
          </div>
        </div>
      </Card>
    </div>
  );
}
