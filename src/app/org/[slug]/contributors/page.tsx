import { ScopeFilterBar } from "@/components/org/ScopeFilterBar";
import { ExportCsvLink, MeterRow, OrgTable, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/ui";
import { CHAMPION_MIN_POP } from "@/components/org/champions";
import { getContributorInsights, type ContributorInsights } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { scoreHex, timeAgo } from "@/lib/ui";

export const dynamic = "force-dynamic";

function AiBar({ pct, color }: { pct: number; color?: string }) {
  return <MeterRow layout="inline" value={pct} display={`${pct}%`} color={color} meterClassName="w-24" />;
}

// AI champions leaderboard — exemplars whose adoption the team could learn from. Rendered by the page
// only once the population clears CHAMPION_MIN_POP (see the gate at the call site).
function ChampionsGrid({ champions }: { champions: ContributorInsights["champions"] }) {
  return (
    <div className="mt-8">
      <SectionHeader
        title="AI champions"
        description="Highest AI adoption across the most repos — exemplars whose approach the team could learn from."
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {champions.map((c, i) => (
          <div key={c.login} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-base text-white">{c.login}</span>
              <span className="font-mono text-sm uppercase tracking-widest text-accent">#{i + 1} ★</span>
            </div>
            {c.name && <div className="text-sm text-slate-500">{c.name}</div>}
            <div className="mt-3"><AiBar pct={c.aiShare} /></div>
            <div className="mt-2 flex gap-4 font-mono text-sm text-slate-400">
              <span>{c.commits} commits</span>
              <span>{c.aiCommits} AI</span>
              <span>{c.repos} repos</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Per-individual involvement — OPT-IN, default collapsed. The default contributor view is team-level
// (the tiles, champions-when-population-allows, and Concentration / bus-factor below); naming individuals
// is a deliberate drill-down for capability/coverage planning, never a passive performance scoreboard.
// The per-person CSV lives here too, behind the same deliberate opt-in.
function IndividualInvolvement({
  insights,
  slug,
  segmentId,
}: {
  insights: ContributorInsights;
  slug: string;
  segmentId: string | null;
}) {
  return (
    <details className="mt-8 rounded-xl border border-slate-800 bg-slate-900/20">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 font-medium text-slate-200 marker:text-slate-600">
        <span>
          Individual involvement <span className="font-mono text-sm text-slate-500">({insights.contributors.length})</span>
        </span>
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">names individuals — expand</span>
      </summary>
      <div className="border-t border-slate-800 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-2xl text-sm text-slate-400">
            For capability and coverage planning — who could seed agent guidance, where key-person risk sits —{" "}
            <span className="text-slate-300">not performance evaluation</span>. Breadth (repos) × depth (commits) and each
            person&apos;s AI-commit share.
          </p>
          <ExportCsvLink org={slug} kind="contributors" segmentId={segmentId} className="shrink-0" />
        </div>
        <OrgTable
          className="mt-3"
          minWidth={720}
          caption="Contributors by involvement — repos, commits, and AI-commit share"
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
                <span className="font-mono text-sm text-white">{c.login}</span>
                {c.name && <span className="ml-2 text-sm text-slate-500">{c.name}</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{c.commits}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-accent">{c.aiCommits}</td>
              <td className="px-3 py-2"><AiBar pct={c.aiShare} /></td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="font-mono text-sm text-slate-400">{c.repos}</span>
                  {c.repoNames.slice(0, 3).map((r) => (
                    <span key={r} className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400">
                      {r.split("/")[1] ?? r}
                    </span>
                  ))}
                  {c.repos > 3 && <span className="font-mono text-sm text-slate-600">+{c.repos - 3}</span>}
                </div>
              </td>
              <td className="px-3 py-2 text-sm text-slate-500">{timeAgo(c.lastActiveAt ?? undefined)}</td>
            </tr>
          ))}
        </OrgTable>
        {insights.contributors.length > 50 && (
          <p className="mt-2 font-mono text-sm text-slate-600">Showing top 50 of {insights.contributors.length} by commits.</p>
        )}
      </div>
    </details>
  );
}

// Concentration / bus factor — how spread out each repo's commits are; high top-share or bus-factor 1
// flags key-person risk.
function ConcentrationTable({ rows }: { rows: ContributorInsights["concentration"] }) {
  return (
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
        caption="AI-commit adoption by repository"
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
        {rows.map((r) => (
          <tr key={r.fullName} className="text-slate-300">
            <td className="px-4 py-2">
              <span className="font-mono text-sm text-white">{r.name}</span>
              {r.soloMaintainer && (
                <span className="ml-2 rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest text-orange-300">
                  key-person
                </span>
              )}
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums">{r.contributorCount}</td>
            <td className="px-3 py-2 font-mono text-sm text-slate-400">{r.topLogin}</td>
            <td className="px-3 py-2">
              <AiBar pct={r.topShare} color={r.topShare >= 80 ? "var(--color-warn)" : undefined} />
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: r.busFactor <= 1 ? "var(--color-warn)" : undefined }}>
              {r.busFactor}
            </td>
          </tr>
        ))}
      </OrgTable>
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

  // Optional segment + tech-stack scope (bogus id/key → whole fleet); the two filters compose.
  const { segments, segmentId, techGroups, activeStack, techGroupId } = await resolveOrgScope(slug, sp);

  const hasFilters = segments.length > 0 || techGroups.length > 0;
  const filterBar = hasFilters && <ScopeFilterBar segments={segments} segmentId={segmentId} techGroups={techGroups} activeStack={activeStack} />;

  const insights = await getContributorInsights(slug, segmentId, techGroupId);
  if (!insights || insights.totalContributors === 0) {
    return (
      <div>
        {filterBar && <div className="mb-4 flex justify-end">{filterBar}</div>}
        <SectionEmpty>No contributor data {segmentId || activeStack ? "for this filter" : "yet"} — scan some of this org&apos;s repositories (contributor data is captured at scan time).</SectionEmpty>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-base text-slate-400">
          Inputs to explore where trust in AI could grow across the team — who&apos;s leaning in, whose approach others could
          learn from, and where key-person risk sits. Not a ranking, and not a to-do list for anyone.
        </p>
        {filterBar && <div className="flex shrink-0 items-center gap-2">{filterBar}</div>}
      </div>

        {/* Summary tiles */}
        <div className={`mt-6 ${TILE_GRID}`}>
          <Tile label="Contributors" value={insights.totalContributors} sub="humans, recent activity" />
          <Tile label="AI-active" value={`${insights.aiActiveShare}%`} sub={`${insights.aiActive} use AI-attributed commits`} color={scoreHex(insights.aiActiveShare)} />
          <Tile label="Org AI commit share" value={`${insights.orgAiShare}%`} sub="commit-weighted across the fleet" color={scoreHex(insights.orgAiShare)} />
          <Tile label="Solo-maintainer repos" value={insights.soloMaintainerCount} sub="1 author or ≥80% concentration" color={insights.soloMaintainerCount > 0 ? "var(--color-warn)" : undefined} />
        </div>

        {/* AI champions — only a meaningful "leaderboard" once the population is large enough. Below 3
            contributors a single Copilot user becomes a celebrated "#1 ★ champion" and the tiles read
            "100% AI-active" for a team of one — success theater that overstates a barely-adopted fleet. */}
        {insights.champions.length > 0 && insights.totalContributors >= CHAMPION_MIN_POP && (
          <ChampionsGrid champions={insights.champions} />
        )}

        <IndividualInvolvement insights={insights} slug={slug} segmentId={segmentId} />

        <ConcentrationTable rows={insights.concentration} />

        <p className="mt-6 max-w-3xl rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-base text-slate-400">
          <span className="text-slate-300">How to read this:</span> these are inputs to explore, never directives. Someone active
          in a repo with thin agent guidance is well placed to seed it; a champion&apos;s approach is a pattern others can borrow.
          The aim is to surface where trust could grow — people decide what to pick up.
        </p>
        <p className="mt-4 font-mono text-sm text-slate-600">
          Metrics reflect the recent-activity commit window captured at scan time. For team-level rollups, see the{" "}
          <span className="text-slate-500">Teams</span> tab (CODEOWNERS attribution). Per-person trend over time,
          “who introduced CLAUDE.md/evals”, and GitHub Teams (GraphQL) attribution are still on the roadmap.
        </p>
      </div>
  );
}
