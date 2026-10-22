// The Contributors tab's one data region — moved from the old page.tsx body (docs/ORG-TABS-REFACTOR.md),
// its two former inline helpers (ChampionsGrid, ConcentrationTable) now real sibling components.

import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { SectionEmpty } from "@/components/org/shared/ui";
import { getContributorInsights } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { resolveOrgWindow } from "@/lib/org/period";
import { decisionMap } from "@/lib/org/decision-map";
import { enablementTargets } from "@/lib/org/adoption";
import { isViewer } from "./ContributorsYouPointer";
import { ContributorsBodyV1 } from "./ContributorsBody.v1";
import { ContributorsBodyV2 } from "./ContributorsBody.v2";
import type { ThemeId } from "@/lib/theme/theme";
// The Delivery tab's settle helper, reused rather than re-implemented: one classification of a
// settled query ("null value" vs "actually failed") for every tab that degrades per section.
import { settle } from "@/features/bought/delivery/deliveryLoad";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function ContributorsInsightsPanel({
  slug,
  sp,
  viewerLogin = null,
  theme = "altimeter",
}: {
  slug: string;
  sp: SearchParams;
  /** The signed-in developer, resolved by the tab — drives the "You" pointer (§5.2). */
  viewerLogin?: string | null;
  theme?: ThemeId;
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

  const body = { slug, insights, period, filterBar, viewerLogin, segmentId, activeStack, decisions, decisionsFailed, enablement, meInRoster };
  return theme === "prism" ? <ContributorsBodyV2 {...body} /> : <ContributorsBodyV1 {...body} />;
}
