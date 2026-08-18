// The Contributors tab's one data region — moved from the old page.tsx body (docs/ORG-TABS-REFACTOR.md),
// its two former inline helpers (ChampionsGrid, ConcentrationTable) now real sibling components.

import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { SectionEmpty, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { getContributorInsights } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { resolveOrgWindow } from "@/lib/org/period";
import { orgTabHref } from "@/lib/org/orgTabs";
import { SnapshotScopeNotice } from "@/components/org/shared/SnapshotScopeNotice";
import { scoreHex } from "@/lib/ui";
import { decisionMap } from "@/lib/org/decision-map";
import { ContributorsChampionsGrid } from "./ContributorsChampionsGrid";
import { ContributorsConcentrationTable } from "./ContributorsConcentrationTable";
import { IndividualInvolvement } from "./IndividualInvolvement";
import { ResilienceModule } from "./ResilienceModule";
import { ContributorsYouStrip, isViewer } from "./ContributorsYouPointer";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function ContributorsInsightsPanel({
  slug,
  sp,
  viewerLogin = null,
}: {
  slug: string;
  sp: SearchParams;
  /** The signed-in developer, resolved by the tab — drives the "You" pointer (§5.2). */
  viewerLogin?: string | null;
}) {
  // Optional segment + tech-stack scope (bogus id/key → whole fleet); the two filters compose.
  const { segments, segmentId, techGroups, activeStack, techGroupId, barProps } = await resolveOrgScope(slug, sp);

  const hasFilters = segments.length > 0 || techGroups.length > 0;
  const filterBar = hasFilters && <ScopeFilterBar {...barProps} />;

  // `period` is resolved ONLY to name it in the notice below. RepoContributor stores cumulative
  // per-(repo, login) commit totals captured at scan time — there is no dated commit history to
  // re-aggregate, so getContributorInsights takes no window and accepting one would be a lie in the
  // signature as well as the UI. See SnapshotScopeNotice for the full argument.
  const [period, insights, decisions] = await Promise.all([
    resolveOrgWindow(sp),
    getContributorInsights(slug, segmentId, techGroupId),
    decisionMap(slug, "contributors"),
  ]);
  if (!insights || insights.totalContributors === 0) {
    return (
      <div>
        {filterBar && <div className="mb-4 flex justify-end">{filterBar}</div>}
        <SectionEmpty>No contributor data {segmentId || activeStack ? "for this filter" : "yet"}. Scan some of this org&apos;s repositories (contributor data is captured at scan time).</SectionEmpty>
      </div>
    );
  }

  // Is the viewer one of the people this tab describes? Below the naming floor the producer returns
  // no per-person rows at all, so this is false and the quiet strip (not a row mark) is what shows.
  const meInRoster = insights.contributors.some((c) => isViewer(c.login, viewerLogin));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-base text-slate-400">
          Inputs to explore where trust in AI could grow across the team: who&apos;s leaning in, whose approach others could
          learn from, and where key-person risk sits. Not a ranking, and not a to-do list for anyone.
        </p>
        {filterBar && <div className="flex shrink-0 items-center gap-2">{filterBar}</div>}
      </div>

      {/* Above the tiles, not under them: the period the user picked on another tab follows them here
          via the cookie, and nothing below honours it. */}
      <div className="mt-6">
        <SnapshotScopeNotice
          period={period}
          subject="contributor"
          scopedHref={orgTabHref(slug, "teams")}
          scopedLabel="Teams"
        />
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
          <Tile label="Org AI commit share" value={`${insights.orgAiShare}%`} sub="commit-weighted (a very small sample)" />
        )}
        <Tile label="Solo-maintainer repos" value={insights.soloMaintainerCount} sub="1 author or ≥80% concentration" color={insights.soloMaintainerCount > 0 ? "var(--color-warn)" : undefined} href="#concentration" />
      </div>

      {/* AI champions — only a meaningful "leaderboard" once the population is large enough. Below 3
          contributors a single Copilot user becomes a celebrated "#1 ★ champion" — success theater
          that overstates a barely-adopted fleet. The floor is enforced in getContributorInsights,
          not here, so every other consumer of it inherits the same suppression. */}
      {insights.champions.length > 0 && (
        <ContributorsChampionsGrid champions={insights.champions} slug={slug} viewerLogin={viewerLogin} />
      )}

      {/* §5.2 — the pointer across to the developer's own view. When the viewer IS in the roster their
          row and champion card carry the mark instead, so the strip would only repeat it. */}
      {meInRoster ? null : <ContributorsYouStrip slug={slug} viewerLogin={viewerLogin} />}

      <IndividualInvolvement
        insights={insights}
        slug={slug}
        segmentId={segmentId}
        stack={activeStack?.key ?? null}
        viewerLogin={viewerLogin}
      />

      {/* G7-18: the fleet read on key-person exposure, above the per-repo table it summarizes. It
          names no individual at any population size — see ResilienceModule's header. */}
      {insights.resilience && <ResilienceModule resilience={insights.resilience} />}

      <ContributorsConcentrationTable slug={slug} rows={insights.concentration} decisions={decisions} />

      <p className="mt-6 max-w-3xl rounded-xl border border-slate-800 bg-slate-900/30 p-4 text-base text-slate-400">
        <span className="text-slate-300">How to read this:</span> these are inputs to explore, never directives. Someone active
        in a repo with thin agent guidance is well placed to seed it; a champion&apos;s approach is a pattern others can borrow.
        The aim is to surface where trust could grow. People decide what to pick up.
      </p>
      {/* Staleness annotation (ambiguity-ui 2026-07-16 #5): the data layer drops repos whose
          snapshot recency trails the fleet's newest scan by ~6 months, so a long-unscanned repo
          can't crown a departed engineer champion — say so instead of silently excluding. */}
      {insights.staleRepos > 0 && (
        <p className="mt-4 font-mono text-sm text-slate-500">
          {insights.staleRepos} {insights.staleRepos === 1 ? "repo" : "repos"} excluded: last scanned too long ago for
          its activity snapshot to blend honestly with the rest. Rescan to include {insights.staleRepos === 1 ? "it" : "them"}.
        </p>
      )}
      <p className="mt-4 font-mono text-sm text-slate-600">
        {/* The scan-time framing leads the panel now (SnapshotScopeNotice); this keeps only the
            pointers it uniquely carries. */}
        For team-level rollups, see the{" "}
        <span className="text-slate-500">Teams</span> tab (CODEOWNERS attribution). Per-person trend over time,
        “who introduced CLAUDE.md/evals”, and GitHub Teams (GraphQL) attribution are still on the roadmap.
      </p>
    </div>
  );
}
