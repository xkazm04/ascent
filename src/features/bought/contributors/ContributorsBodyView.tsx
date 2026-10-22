// The composition of the Contributors tab body. Reads and the same sections; what
// changes is the structure: a masthead carries the four headline numbers (the v1 tile strip), and every
// section sits in a hairline Frame instead of floating at its own margin. The sections keep their own
// heads, so no heading is doubled. Nothing here names a person below the naming floor: the sections
// enforce that, this file only places them.
import { Frame, Masthead } from "@/components/kit";
import { SectionEmpty } from "@/components/shared/dashboard/ui";
import { SnapshotScopeNotice } from "@/components/shared/scope/SnapshotScopeNotice";
import { orgTabHref } from "@/lib/org/orgTabs";
import { ContributorsChampionsGrid } from "./ContributorsChampionsGrid";
import { ContributorsAdoptionStrip } from "./ContributorsAdoptionStrip";
import { ContributorsNotes } from "./ContributorsNotes";
import { ContributorsConcentrationTable } from "./ContributorsConcentrationTable";
import { EnablementTargets } from "./EnablementTargets";
import { IndividualInvolvement } from "./IndividualInvolvement";
import { ResilienceModule } from "./ResilienceModule";
import { ContributorsYouStrip } from "./ContributorsYouPointer";
import { contributorFigures } from "./contributorsFigures";
import type { ContributorsBodyProps } from "./contributorsBody";

export function ContributorsBody({
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
    <div data-role="contributors-v2" className="space-y-2">
      <Masthead
        eyebrow="Bought · contributors"
        statement="Who is leaning in,"
        named="and where risk sits."
        lede="Inputs to explore where trust in AI could grow. Never a ranking, never directives for anyone."
        figures={contributorFigures(insights)}
        aside={filterBar || undefined}
        pattern="dots"
      />

      {/* The period the user picked on another tab follows them here via the cookie; nothing below honours it. */}
      {period && (
        <SnapshotScopeNotice period={period} subject="contributor" scopedHref={orgTabHref(slug, "teams")} scopedLabel="Teams" />
      )}

      <Frame pad="sm" aria-label="AI-authored share per contributor">
        <ContributorsAdoptionStrip insights={insights} viewerLogin={viewerLogin} />
      </Frame>

      {insights.champions.length > 0 && (
        <Frame pad="sm" aria-label="AI champions">
          <ContributorsChampionsGrid champions={insights.champions} slug={slug} viewerLogin={viewerLogin} />
        </Frame>
      )}

      {meInRoster ? null : (
        <ContributorsYouStrip slug={slug} viewerLogin={viewerLogin} namingAllowed={insights.namingAllowed} />
      )}

      <Frame pad="sm" aria-label="Individual involvement">
        <IndividualInvolvement
          insights={insights}
          slug={slug}
          segmentId={segmentId}
          stack={activeStack?.key ?? null}
          viewerLogin={viewerLogin}
        />
      </Frame>

      {enablement.length > 0 && (
        <Frame pad="sm" aria-label="Who to enable next">
          <EnablementTargets targets={enablement} nonePool={insights.distribution.none} />
        </Frame>
      )}

      {insights.resilience && (
        <Frame pad="sm" aria-label="Resilience">
          <ResilienceModule resilience={insights.resilience} concentration={insights.concentration} />
        </Frame>
      )}

      <Frame pad="sm" edge="both" aria-label="Concentration and bus factor">
        <ContributorsConcentrationTable
          slug={slug}
          rows={insights.concentration}
          contributors={insights.contributors}
          namingAllowed={insights.namingAllowed}
          decisions={decisions}
        />
        {decisionsFailed && (
          <div className="mt-4">
            <SectionEmpty>Recorded decisions couldn&apos;t load right now, so the table above shows none. Try refreshing this page.</SectionEmpty>
          </div>
        )}
      </Frame>

      <ContributorsNotes slug={slug} staleRepos={insights.staleRepos} />
    </div>
  );
}
