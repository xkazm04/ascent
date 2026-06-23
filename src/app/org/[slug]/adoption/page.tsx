// The "Adoption" tab (Direction #1 phase 1) — AI-adoption intelligence: how much of the org's work is
// AI-assisted, the champions, and the delivery health it sits alongside. Assembled from existing
// contributor AI-attribution + PR signals (no new ingestion). Delivery is shown as honest context.

import { buildAdoptionOverview, adoptionMarkdown } from "@/lib/org/adoption";
import { Card, InlineEmpty, Meter, MeterRow, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { CHAMPION_MIN_POP } from "@/components/org/champions";
import { CopyForLlm } from "@/components/CopyForLlm";
import { scoreHex } from "@/lib/ui";

export const dynamic = "force-dynamic";

const BAND = { high: "#16a34a", some: "#3b9eff", none: "#64748b" } as const;

export default async function OrgAdoption({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await buildAdoptionOverview(slug);

  if (!a) {
    return (
      <SectionEmpty>
        No contributor data yet — scan some of this org&apos;s repositories (with a GitHub token for commit history) to measure AI adoption.
      </SectionEmpty>
    );
  }

  const md = adoptionMarkdown(a);
  const d = a.delivery;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title="AI adoption"
          description="How AI-native the org's engineering actually is — commit-level AI attribution, the champions carrying the culture, and the delivery health it sits beside. Copy the brief into Claude Code for an enablement plan."
        />
        <CopyForLlm text={md} label="Copy adoption brief for LLM" />
      </div>

      <div className={TILE_GRID}>
        <Tile label="Org AI commit share" value={`${a.orgAiShare}%`} color={scoreHex(a.orgAiShare)} sub="commit-weighted" />
        <Tile
          label="AI-active contributors"
          value={`${a.contributors.aiActive}/${a.contributors.total}`}
          sub={`${a.contributors.aiActiveShare}% of contributors`}
          color={scoreHex(a.contributors.aiActiveShare)}
        />
        <Tile label="Typical PR merge time" value={d?.typicalHoursToMerge != null ? `${d.typicalHoursToMerge}h` : "—"} sub={d ? `${d.prs} PRs` : "no PR data"} />
        <Tile label="AI-involved PRs" value={d ? `${d.aiInvolvedRate}%` : "—"} color={d ? scoreHex(d.aiInvolvedRate) : undefined} />
      </div>

      <Card>
        <SectionHeader size="sm" title="Adoption spread" description="Contributors by how much of their own work is AI-attributed." />
        <div className="mt-3 grid grid-cols-3 gap-3">
          {(["high", "some", "none"] as const).map((k) => (
            <div key={k} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <div className="font-mono text-2xl font-bold tabular-nums" style={{ color: BAND[k] }}>{a.distribution[k]}</div>
              <div className="mt-0.5 font-mono text-sm text-slate-400">
                {k === "high" ? "heavy (≥50%)" : k === "some" ? "partial (1–49%)" : "none (0%)"}
              </div>
            </div>
          ))}
        </div>
        {a.knowledgeLeader && (
          <p className="mt-3 font-mono text-sm text-slate-500">
            Most AI-attributed team: <span className="text-slate-300">{a.knowledgeLeader.name}</span> · {a.knowledgeLeader.aiCommitShare}% AI commit share
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader size="sm" title="AI champions" description="Culture carriers — high AI adoption across real volume." />
          {a.contributors.total < CHAMPION_MIN_POP ? (
            // Same small-population guard as the Contributors tab: below the floor, one AI user reads as a
            // celebrated "#1" — a ranking, not a culture signal. Suppress consistently across tabs.
            <InlineEmpty>Too few contributors to surface champions without it reading as a ranking.</InlineEmpty>
          ) : a.champions.length === 0 ? (
            <InlineEmpty>No AI-attributed contributors yet.</InlineEmpty>
          ) : (
            <div className="mt-3 space-y-1.5">
              {a.champions.map((c) => (
                <div key={c.login} className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 truncate font-mono text-slate-200" title={c.login}>{c.login}</span>
                  <Meter className="flex-1" value={c.aiShare} color={scoreHex(c.aiShare)} />
                  <span className="w-28 shrink-0 text-right font-mono text-sm text-slate-400">
                    {c.aiShare}% · {c.aiCommits}/{c.commits}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader size="sm" title="Delivery (context)" description="Shown beside adoption — not a causal claim." />
          {!d ? (
            <InlineEmpty>No pull-request data — connect a GitHub token/App to read PR signals.</InlineEmpty>
          ) : (
            <div className="mt-3 space-y-2">
              {d.reviewedRate != null && <DeliveryRow label="Reviewed PRs" value={`${d.reviewedRate}%`} rate={d.reviewedRate} />}
              <DeliveryRow label="Merge rate" value={`${d.mergeRate}%`} rate={d.mergeRate} />
              <DeliveryRow label="AI-involved PRs" value={`${d.aiInvolvedRate}%`} rate={d.aiInvolvedRate} />
              <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-sm">
                <span className="text-slate-400">Typical merge time</span>
                <span className="font-mono text-slate-300">{d.typicalHoursToMerge != null ? `${d.typicalHoursToMerge}h` : "—"}</span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function DeliveryRow({ label, value, rate }: { label: string; value: string; rate: number }) {
  return (
    <MeterRow
      layout="labelled"
      label={label}
      value={rate}
      display={value}
      color={scoreHex(rate)}
      meterSize="md"
      meterClassName="flex-1"
      valueClassName="w-12 shrink-0 text-right font-mono text-slate-300"
    />
  );
}
