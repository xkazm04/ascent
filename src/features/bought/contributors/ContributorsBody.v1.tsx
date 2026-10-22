// The Altimeter composition of the Contributors tab body: the former tail of ContributorsInsightsPanel,
// moved here unchanged (the panel keeps the reads, the empty states and the per-section degradation).

import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { SectionEmpty } from "@/components/org/shared/ui";
import { orgTabHref } from "@/lib/org/orgTabs";
import { SnapshotScopeNotice } from "@/components/org/shared/SnapshotScopeNotice";
import { ContributorsChampionsGrid } from "./ContributorsChampionsGrid";
import { ContributorsAdoptionStrip } from "./ContributorsAdoptionStrip";
import { ContributorsNotes } from "./ContributorsNotes";
import { ContributorsTiles } from "./ContributorsTiles";
import { ContributorsConcentrationTable } from "./ContributorsConcentrationTable";
import { EnablementTargets } from "./EnablementTargets";
import { IndividualInvolvement } from "./IndividualInvolvement";
import { ResilienceModule } from "./ResilienceModule";
import { ContributorsYouStrip } from "./ContributorsYouPointer";
import type { ContributorsBodyProps } from "./contributorsBody";

export function ContributorsBodyV1({
  slug,
  insights,
  period,
  filterBar,
  viewerLogin,
  segmentId,
  activeStack,
  decisions,
  decisionsFailed,
  enablement,
  meInRoster,
}: ContributorsBodyProps) {
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
