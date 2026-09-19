// The Contributors tab's one data region — moved from the old page.tsx body (docs/ORG-TABS-REFACTOR.md),
// its two former inline helpers (ChampionsGrid, ConcentrationTable) now real sibling components.

import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { SectionEmpty } from "@/components/org/shared/ui";
import { getContributorInsights } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { resolveOrgWindow } from "@/lib/org/period";
import { orgTabHref } from "@/lib/org/orgTabs";
import { SnapshotScopeNotice } from "@/components/org/shared/SnapshotScopeNotice";
import { decisionMap } from "@/lib/org/decision-map";
import { enablementTargets } from "@/lib/org/adoption";
import { ContributorsChampionsGrid } from "./ContributorsChampionsGrid";
import { ContributorsAdoptionStrip } from "./ContributorsAdoptionStrip";
import { ContributorsNotes } from "./ContributorsNotes";
import { ContributorsTiles } from "./ContributorsTiles";
import { ContributorsConcentrationTable } from "./ContributorsConcentrationTable";
import { EnablementTargets } from "./EnablementTargets";
import { IndividualInvolvement } from "./IndividualInvolvement";
import { ResilienceModule } from "./ResilienceModule";
import { ContributorsYouStrip, isViewer } from "./ContributorsYouPointer";
// The Delivery tab's settle helper, reused rather than re-implemented: one classification of a
// settled query ("null value" vs "actually failed") for every tab that degrades per section.
import { settle } from "@/features/bought/delivery/deliveryLoad";

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
  // Per-section degradation (the Delivery tab's G4-10 fix, applied here): under Promise.all a blip on
  // decisionMap — an annotation on the concentration table — rejected the whole tab and blanked the
  // tiles, the champions grid, the roster and the resilience read that would all have rendered fine.
  const [periodSettled, insightsSettled, decisionsSettled] = await Promise.allSettled([
    resolveOrgWindow(sp),
    getContributorInsights(slug, segmentId, techGroupId),
    decisionMap(slug, "contributors"),
  ]);
  const { value: period } = settle(periodSettled);
  const { value: insights, failed: insightsFailed } = settle(insightsSettled);
  const { value: decisionsValue, failed: decisionsFailed } = settle(decisionsSettled);
  const decisions = decisionsValue ?? {};
  for (const [label, r] of [
    ["resolveOrgWindow", periodSettled],
    ["getContributorInsights", insightsSettled],
    ["decisionMap", decisionsSettled],
  ] as const) {
    if (r.status === "rejected") console.error(`[contributors/${slug}] ${label} failed:`, r.reason);
  }
  if (!insights || insights.totalContributors === 0) {
    return (
      <div>
        {filterBar && <div className="mb-4 flex justify-end">{filterBar}</div>}
        {/* "Couldn't load" is a different claim from "no contributor data" — sending someone off to
            scan repositories they have already scanned is the wrong instruction for a failed query. */}
        {insightsFailed ? (
          <SectionEmpty>Contributor data couldn&apos;t load right now (a query failed). Try refreshing this page.</SectionEmpty>
        ) : (
          // (O) The tab's old permanent lede lands here, where the reader has nothing to look at and
          // genuinely needs the argument for scanning: what this surface is FOR.
          <SectionEmpty>
            No contributor data {segmentId || activeStack ? "for this filter" : "yet"}. Scan some of this org&apos;s
            repositories (contributor data is captured at scan time) to see where trust in AI could grow across the
            team: who&apos;s leaning in, whose approach others could learn from, and where key-person risk sits. These
            are inputs to explore, never a ranking and never directives for anyone.
          </SectionEmpty>
        )}
      </div>
    );
  }

  // Is the viewer one of the people this tab describes? Below the naming floor the producer returns
  // no per-person rows at all, so this is false and the quiet strip (not a row mark) is what shows.
  const meInRoster = insights.contributors.some((c) => isViewer(c.login, viewerLogin));

  // The zero-AI enablement cohort, off the insights already read. Same helper the adoption LLM brief
  // uses, so the two can never disagree about who is on the list.
  const enablement = enablementTargets(insights);

  return (
    <div>
      {/* §2.2 — the topmost element under the tab header is a shape, not a sentence. The lede that
          used to sit here is now the empty state's argument (O) and the strip's WhyChip (D). */}
      {filterBar && <div className="flex justify-end">{filterBar}</div>}

      {/* Above the tiles, not under them: the period the user picked on another tab follows them here
          via the cookie, and nothing below honours it. */}
      {period && (
        <div className="mt-6">
          <SnapshotScopeNotice
            period={period}
            subject="contributor"
            scopedHref={orgTabHref(slug, "teams")}
            scopedLabel="Teams"
          />
        </div>
      )}

      <ContributorsAdoptionStrip insights={insights} viewerLogin={viewerLogin} />

      <ContributorsTiles insights={insights} />

      {/* AI champions — only a meaningful "leaderboard" once the population is large enough. Below 3
          contributors a single Copilot user becomes a celebrated "#1 ★ champion" — success theater
          that overstates a barely-adopted fleet. The floor is enforced in getContributorInsights,
          not here, so every other consumer of it inherits the same suppression. */}
      {insights.champions.length > 0 && (
        <ContributorsChampionsGrid champions={insights.champions} slug={slug} viewerLogin={viewerLogin} />
      )}

      {/* §5.2 — the pointer across to the developer's own view. When the viewer IS in the roster their
          row and champion card carry the mark instead, so the strip would only repeat it. Below the
          naming floor NOBODY is in the roster (the producer empties it), so the strip must say the
          attribution was withheld rather than assert the viewer has no commits — hence namingAllowed. */}
      {meInRoster ? null : (
        <ContributorsYouStrip slug={slug} viewerLogin={viewerLogin} namingAllowed={insights.namingAllowed} />
      )}

      <IndividualInvolvement
        insights={insights}
        slug={slug}
        segmentId={segmentId}
        stack={activeStack?.key ?? null}
        viewerLogin={viewerLogin}
      />

      {/* "Who to enable next" — moved here from Adoption (2026-08-19). It belongs beside the roster
          above it: both are named per-person lists, and this one is the other half of the same
          question ("who is leaning in" / "who hasn't started"). Derived from the insights already in
          hand via the shared `enablementTargets`, so it costs no extra read; an empty list renders
          nothing, which is also the privacy floor's guard. */}
      {enablement.length > 0 && (
        <div className="mt-6">
          <EnablementTargets targets={enablement} nonePool={insights.distribution.none} />
        </div>
      )}

      {/* G7-18: the fleet read on key-person exposure, above the per-repo table it summarizes. It
          names no individual at any population size — see ResilienceModule's header. */}
      {insights.resilience && (
        <ResilienceModule resilience={insights.resilience} concentration={insights.concentration} />
      )}

      <ContributorsConcentrationTable
        slug={slug}
        rows={insights.concentration}
        contributors={insights.contributors}
        namingAllowed={insights.namingAllowed}
        decisions={decisions}
      />

      {/* The decisions annotation degrades alone: the table above still renders, and this says the
          annotations are missing rather than letting them read as "no decisions recorded". */}
      {decisionsFailed && (
        <div className="mt-4">
          <SectionEmpty>Recorded decisions couldn&apos;t load right now, so the table above shows none. Try refreshing this page.</SectionEmpty>
        </div>
      )}

      {/* Staleness annotation (ambiguity-ui 2026-07-16 #5): the data layer drops repos whose
          snapshot recency trails the fleet's newest scan by ~6 months, so a long-unscanned repo
          can't crown a departed engineer champion. The COUNT stays on screen as a void mark; the
          explanation and the roadmap inventory that used to trail it are demoted (D / F). */}
      <ContributorsNotes slug={slug} staleRepos={insights.staleRepos} />
    </div>
  );
}
