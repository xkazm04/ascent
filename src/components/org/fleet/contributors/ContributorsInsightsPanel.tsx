// The Contributors tab's one data region — moved from the old page.tsx body (docs/ORG-TABS-REFACTOR.md),
// its two former inline helpers (ChampionsGrid, ConcentrationTable) now real sibling components.

import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { SectionEmpty, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { getContributorInsights } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { scoreHex } from "@/lib/ui";
import { decisionMap } from "@/lib/org/decision-map";
import { ContributorsChampionsGrid } from "./ContributorsChampionsGrid";
import { ContributorsConcentrationTable } from "./ContributorsConcentrationTable";
import { IndividualInvolvement } from "./IndividualInvolvement";
import { ResilienceModule } from "./ResilienceModule";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function ContributorsInsightsPanel({ slug, sp }: { slug: string; sp: SearchParams }) {
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
      {insights.champions.length > 0 && <ContributorsChampionsGrid champions={insights.champions} />}

      <IndividualInvolvement insights={insights} slug={slug} segmentId={segmentId} stack={activeStack?.key ?? null} />

      {/* G7-18: the fleet read on key-person exposure, above the per-repo table it summarizes. It
          names no individual at any population size — see ResilienceModule's header. */}
      {insights.resilience && <ResilienceModule resilience={insights.resilience} />}

      <ContributorsConcentrationTable slug={slug} rows={insights.concentration} decisions={decisions} />

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
