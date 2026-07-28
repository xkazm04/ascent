import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { OrgTable, SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { getContributorInsights, type ContributorInsights } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { scoreHex } from "@/lib/ui";
import { DecisionControl } from "@/components/org/DecisionControl";
import { decisionMap, type DecisionMap } from "@/lib/org/decision-map";
import { AiBar } from "./AiBar";
import { IndividualInvolvement } from "./IndividualInvolvement";

export const dynamic = "force-dynamic";

// AI champions leaderboard — exemplars whose adoption the team could learn from. The population floor
// is applied by getContributorInsights itself (it returns `champions: []` below CHAMPION_MIN_POP), so
// this renders whatever the producer was willing to name — there is nothing left to gate here.
function ChampionsGrid({ champions }: { champions: ContributorInsights["champions"] }) {
  return (
    <div className="mt-8">
      <SectionHeader
        title="AI champions"
        description="Highest AI adoption across the most repos, weighted by breadth and activity — exemplars whose approach the team could learn from."
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


// Concentration / bus factor — how spread out each repo's commits are; high top-share or bus-factor 1
// flags key-person risk. A key-person repo is a DECISION, not just a warning chip: accept the risk,
// dismiss it with a reason, or snooze — and it leaves the org rail's Contributors badge either way.
function ConcentrationTable({
  slug,
  rows,
  decisions,
}: {
  slug: string;
  rows: ContributorInsights["concentration"];
  decisions: DecisionMap;
}) {
  return (
    <div id="concentration" className="mt-8 scroll-mt-24">
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
        caption="Commit concentration and bus factor by repository"
        head={
          <tr>
            <th className="px-4 py-2 text-left">Repo</th>
            <th className="px-3 py-2 text-right">Contributors</th>
            <th className="px-3 py-2 text-left">Top contributor</th>
            <th className="px-3 py-2 text-left">Top share</th>
            <th className="px-3 py-2 text-right">Bus factor</th>
            <th className="px-3 py-2 text-left">Decision</th>
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
            <td className="px-3 py-2">
              {/* Only solo-maintained repos are findings — the rest have nothing to decide. */}
              {r.soloMaintainer ? (
                <DecisionControl
                  org={slug}
                  module="contributors"
                  itemKey={r.fullName}
                  title={`${r.fullName} is solo-maintained`}
                  status={decisions[r.fullName]?.status ?? "open"}
                  rationale={decisions[r.fullName]?.rationale}
                  decidedBy={decisions[r.fullName]?.decidedBy}
                />
              ) : (
                <span className="text-slate-600">—</span>
              )}
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
  const { segments, segmentId, techGroups, activeStack, techGroupId, barProps } = await resolveOrgScope(slug, sp);

  const hasFilters = segments.length > 0 || techGroups.length > 0;
  const filterBar = hasFilters && <ScopeFilterBar {...barProps} />;

  const [insights, decisions] = await Promise.all([
    getContributorInsights(slug, segmentId, techGroupId),
    decisionMap(slug, "contributors"),
  ]);
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

        {/* Summary tiles — each deep-links to its evidence section (the Teams tab's tile pattern),
            so the warn-colored key-person stat jumps straight to the concentration table + decisions. */}
        <div className={`mt-6 ${TILE_GRID}`}>
          <Tile label="Contributors" value={insights.totalContributors} sub="humans, recent activity" href="#individuals" />
          {/* Below the naming floor a percentage is the wrong unit: "100% AI-active" for a two-person
              org is one person, stated as a fleet-wide claim (and colored green as if it were an
              achievement). Show the raw count instead — same information, no false confidence. */}
          {insights.namingAllowed ? (
            <Tile label="AI-active" value={`${insights.aiActiveShare}%`} sub={`${insights.aiActive} use AI-attributed commits`} color={scoreHex(insights.aiActiveShare)} href="#individuals" />
          ) : (
            <Tile label="AI-active" value={`${insights.aiActive}/${insights.totalContributors}`} sub="too few contributors to read as a rate" />
          )}
          {insights.namingAllowed ? (
            <Tile label="Org AI commit share" value={`${insights.orgAiShare}%`} sub="commit-weighted across the fleet" color={scoreHex(insights.orgAiShare)} />
          ) : (
            <Tile label="Org AI commit share" value={`${insights.orgAiShare}%`} sub="commit-weighted — a very small sample" />
          )}
          <Tile label="Solo-maintainer repos" value={insights.soloMaintainerCount} sub="1 author or ≥80% concentration" color={insights.soloMaintainerCount > 0 ? "var(--color-warn)" : undefined} href="#concentration" />
        </div>

        {/* AI champions — only a meaningful "leaderboard" once the population is large enough. Below 3
            contributors a single Copilot user becomes a celebrated "#1 ★ champion" — success theater
            that overstates a barely-adopted fleet. The floor is enforced in getContributorInsights,
            not here, so every other consumer of it inherits the same suppression. */}
        {insights.champions.length > 0 && <ChampionsGrid champions={insights.champions} />}

        <IndividualInvolvement insights={insights} slug={slug} segmentId={segmentId} stack={activeStack?.key ?? null} />

        <ConcentrationTable slug={slug} rows={insights.concentration} decisions={decisions} />

        <p className="mt-6 max-w-3xl rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-base text-slate-400">
          <span className="text-slate-300">How to read this:</span> these are inputs to explore, never directives. Someone active
          in a repo with thin agent guidance is well placed to seed it; a champion&apos;s approach is a pattern others can borrow.
          The aim is to surface where trust could grow — people decide what to pick up.
        </p>
        {/* Staleness annotation (ambiguity-ui 2026-07-16 #5): the data layer drops repos whose
            snapshot recency trails the fleet's newest scan by ~6 months, so a long-unscanned repo
            can't crown a departed engineer champion — say so instead of silently excluding. */}
        {insights.staleRepos > 0 && (
          <p className="mt-4 font-mono text-sm text-slate-500">
            {insights.staleRepos} {insights.staleRepos === 1 ? "repo" : "repos"} excluded — last scanned too long ago for
            its activity snapshot to blend honestly with the rest. Rescan to include {insights.staleRepos === 1 ? "it" : "them"}.
          </p>
        )}
        <p className="mt-4 font-mono text-sm text-slate-600">
          Metrics reflect the recent-activity commit window captured at scan time. For team-level rollups, see the{" "}
          <span className="text-slate-500">Teams</span> tab (CODEOWNERS attribution). Per-person trend over time,
          “who introduced CLAUDE.md/evals”, and GitHub Teams (GraphQL) attribution are still on the roadmap.
        </p>
      </div>
  );
}
