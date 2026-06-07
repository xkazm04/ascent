import { SegmentSelector } from "@/components/org/SegmentSelector";
import { Meter, OrgTable, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { getContributorInsights, listSegments } from "@/lib/db";
import { scoreHex, timeAgo } from "@/lib/ui";

export const dynamic = "force-dynamic";

function AiBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <Meter className="w-24" size="sm" value={pct} />
      <span className="w-9 font-mono text-xs text-slate-500">{pct}%</span>
    </div>
  );
}

export default async function ContributorInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  // Optional segment scope, validated against the org's segments (bogus id → whole fleet).
  const segments = (await listSegments(slug)) ?? [];
  const segParam = Array.isArray(sp.segment) ? sp.segment[0] : sp.segment;
  const segmentId = segments.find((s) => s.id === segParam)?.id ?? null;

  const insights = await getContributorInsights(slug, segmentId);
  if (!insights || insights.totalContributors === 0) {
    return (
      <div>
        {segments.length > 0 && (
          <div className="mb-4 flex justify-end">
            <SegmentSelector segments={segments} active={segmentId} />
          </div>
        )}
        <SectionEmpty>No contributor data {segmentId ? "for this segment" : "yet"} — scan some of this org&apos;s repositories (contributor data is captured at scan time).</SectionEmpty>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-400">
          Inputs to explore where trust in AI could grow across the team — who&apos;s leaning in, whose approach others could
          learn from, and where key-person risk sits. Not a ranking, and not a to-do list for anyone.
        </p>
        {segments.length > 0 && <SegmentSelector segments={segments} active={segmentId} />}
      </div>

        {/* Summary tiles */}
        <div className={`mt-6 ${TILE_GRID}`}>
          <Tile label="Contributors" value={insights.totalContributors} sub="humans, recent activity" />
          <Tile label="AI-active" value={`${insights.aiActiveShare}%`} sub={`${insights.aiActive} use AI-attributed commits`} color={scoreHex(insights.aiActiveShare)} />
          <Tile label="Org AI commit share" value={`${insights.orgAiShare}%`} sub="commit-weighted across the fleet" color={scoreHex(insights.orgAiShare)} />
          <Tile label="Solo-maintainer repos" value={insights.soloMaintainerCount} sub="1 author or ≥80% concentration" color={insights.soloMaintainerCount > 0 ? "var(--color-warn)" : undefined} />
        </div>

        {/* AI champions */}
        {insights.champions.length > 0 && (
          <div className="mt-8">
            <SectionHeader
              title="AI champions"
              description="Highest AI adoption across the most repos — exemplars whose approach the team could learn from."
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {insights.champions.map((c, i) => (
                <div key={c.login} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-white">{c.login}</span>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-accent">#{i + 1} ★</span>
                  </div>
                  {c.name && <div className="text-xs text-slate-500">{c.name}</div>}
                  <div className="mt-3"><AiBar pct={c.aiShare} /></div>
                  <div className="mt-2 flex gap-4 font-mono text-[11px] text-slate-400">
                    <span>{c.commits} commits</span>
                    <span>{c.aiCommits} AI</span>
                    <span>{c.repos} repos</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Involvement table */}
        <div className="mt-8">
          <SectionHeader
            title="Involvement"
            description="Breadth (repos) × depth (commits) and each person's AI-commit share — context to explore, not a scoreboard."
          />
          <OrgTable
            className="mt-3"
            minWidth={720}
            head={
              <tr>
                <th className="px-4 py-2 text-left">Contributor</th>
                <th className="px-3 py-2 text-right">Commits</th>
                <th className="px-3 py-2 text-right">AI</th>
                <th className="px-3 py-2 text-left">AI share</th>
                <th className="px-3 py-2 text-left">Repos</th>
                <th className="px-3 py-2 text-left">Last active</th>
              </tr>
            }
          >
            {insights.contributors.slice(0, 50).map((c) => (
                  <tr key={c.login} className="text-slate-300">
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs text-white">{c.login}</span>
                      {c.name && <span className="ml-2 text-xs text-slate-500">{c.name}</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{c.commits}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-accent">{c.aiCommits}</td>
                    <td className="px-3 py-2"><AiBar pct={c.aiShare} /></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="font-mono text-xs text-slate-400">{c.repos}</span>
                        {c.repoNames.slice(0, 3).map((r) => (
                          <span key={r} className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                            {r.split("/")[1] ?? r}
                          </span>
                        ))}
                        {c.repos > 3 && <span className="font-mono text-[10px] text-slate-600">+{c.repos - 3}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{timeAgo(c.lastActiveAt ?? undefined)}</td>
                  </tr>
                ))}
          </OrgTable>
          {insights.contributors.length > 50 && (
            <p className="mt-2 font-mono text-[11px] text-slate-600">Showing top 50 of {insights.contributors.length} by commits.</p>
          )}
        </div>

        {/* Concentration / bus factor */}
        <div className="mt-8">
          <SectionHeader
            title="Concentration & bus factor"
            description={
              <>
                How spread out each repo&apos;s commits are.{" "}
                <span className="text-orange-400">High top-share or bus-factor 1 = key-person risk.</span>
              </>
            }
          />
          <OrgTable
            className="mt-3"
            head={
              <tr>
                <th className="px-4 py-2 text-left">Repo</th>
                <th className="px-3 py-2 text-right">Contributors</th>
                <th className="px-3 py-2 text-left">Top contributor</th>
                <th className="px-3 py-2 text-left">Top share</th>
                <th className="px-3 py-2 text-right">Bus factor</th>
              </tr>
            }
          >
            {insights.concentration.map((r) => (
                  <tr key={r.fullName} className="text-slate-300">
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs text-white">{r.name}</span>
                      {r.soloMaintainer && (
                        <span className="ml-2 rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-orange-300">
                          key-person
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{r.contributorCount}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{r.topLogin}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Meter className="w-24" size="sm" value={r.topShare} color={r.topShare >= 80 ? "var(--color-warn)" : "var(--color-accent)"} />
                        <span className="w-9 font-mono text-xs text-slate-500">{r.topShare}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: r.busFactor <= 1 ? "var(--color-warn)" : undefined }}>
                      {r.busFactor}
                    </td>
                  </tr>
                ))}
          </OrgTable>
        </div>

        <p className="mt-6 max-w-3xl rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-sm text-slate-400">
          <span className="text-slate-300">How to read this:</span> these are inputs to explore, never directives. Someone active
          in a repo with thin agent guidance is well placed to seed it; a champion&apos;s approach is a pattern others can borrow.
          The aim is to surface where trust could grow — people decide what to pick up.
        </p>
        <p className="mt-4 font-mono text-[11px] text-slate-600">
          Metrics reflect the recent-activity commit window captured at scan time. For team-level rollups, see the{" "}
          <span className="text-slate-500">Teams</span> tab (CODEOWNERS attribution). Per-person trend over time,
          “who introduced CLAUDE.md/evals”, and GitHub Teams (GraphQL) attribution are still on the roadmap.
        </p>
      </div>
  );
}
