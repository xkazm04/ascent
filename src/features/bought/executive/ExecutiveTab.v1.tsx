// Altimeter composition of the Briefing tab. Markup moved unchanged from ExecutiveTab.
// The public share page does not use this file.
import { valueRealizedHeading, valueRealizedLine } from "@/lib/org/briefing";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import Link from "next/link";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { PriorPeriodGrid } from "./briefingShared";
import {
  BriefingBrandHeader,
  BriefingDimensionCards,
  BriefingGoalsCard,
  BriefingMovementCard,
  BriefingTiles,
  hasBriefingBrand,
} from "./briefingCards";
import { BriefingProofBanner } from "./BriefingProofBanner";
import { ExecutiveTabActions } from "./ExecutiveTabActions";
import { BriefingBasisNote } from "./BriefingBasisNote";
import { ImpactLedger } from "./ImpactLedger";
import { ExecutiveSignalsStrip } from "./ExecutiveSignalsStrip";
import { ExecutiveTrajectoryCard } from "./ExecutiveTrajectoryCard";
import { BrandingSettings } from "./BrandingSettings";
import { ShareLinkInventory } from "./ShareLinkInventory";
import { OrgLeverageMoves } from "./OrgLeverageMoves";
import { ProgramPanel } from "./ProgramPanel";
import type { ExecutiveView } from "./executiveView";

export function executiveV1(v: ExecutiveView) {
  const { slug, period, segmentId, techGroups, activeStack, briefing, md, impact, program, canShare, branding, canBrand } = v;
  const orgRecs = briefing.recommendations ?? [];
  const { maturity, benchmark } = briefing;
  return (
    <div className="space-y-6">
      {canBrand && hasBriefingBrand(branding) && <BriefingBrandHeader branding={branding} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader title="Executive briefing" description={period.title} />
        <ExecutiveTabActions
          slug={slug}
          period={period}
          segmentId={segmentId}
          techGroups={techGroups}
          activeStack={activeStack}
          canShare={canShare}
          md={md}
        />
      </div>

      <BriefingTiles
        maturity={maturity}
        benchmark={benchmark}
        delta={briefing.periodDelta}
        deltaLabel={period.comparisonLabel}
        movement={briefing.periodMovement}
        realScoredCount={briefing.realScoredCount}
        orgSlug={slug}
      />

      <BriefingBasisNote briefing={briefing} />

      {valueRealizedLine(briefing.valueRealized, briefing.realScoredCount, briefing.periodMovement?.cohortSize) && (
        <div className="rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
          <span className="type-mono-sm uppercase tracking-widest text-accent">{valueRealizedHeading(briefing.valueRealized)}</span>{" "}
          <span className="type-body text-slate-200">
            {valueRealizedLine(briefing.valueRealized, briefing.realScoredCount, briefing.periodMovement?.cohortSize)}
          </span>
        </div>
      )}

      <BriefingProofBanner proof={briefing.proof} loopProof={briefing.loopProof} />

      {impact && <ImpactLedger slug={slug} ledger={impact} periodTitle={period.title} />}

      <ProgramPanel slug={slug} initial={program} now={briefing.realScoredCount > 0 ? maturity.overall : null} />

      <ExecutiveSignalsStrip briefing={briefing} />

      <ExecutiveTrajectoryCard briefing={briefing} periodHasStart={!!period.start} />

      {briefing.priorPeriod && (
        <Card>
          <SectionHeader size="sm" title="vs previous period" />
          <PriorPeriodGrid
            prior={briefing.priorPeriod}
            now={maturity}
            nowScoredCount={briefing.realScoredCount}
            priorScoredCount={briefing.priorPeriod.realScoredCount}
            showDimensions
          />
        </Card>
      )}

      {orgRecs.length > 0 && <OrgLeverageMoves recs={orgRecs} slug={slug} />}

      <BriefingDimensionCards
        strengths={briefing.strengths}
        risks={briefing.risks}
        security={briefing.security}
        practiceOrgSlug={slug}
      />

      <BriefingMovementCard gainers={briefing.topGainers} regressions={briefing.topRegressions} reportLinks />

      <BriefingGoalsCard goals={briefing.goals} emptyText="No goals set." />

      {/* Owner-only: the inventory of links this org has already published, and the control that
          retires one. Sits beside the other owner controls rather than in the header row, because it is
          a list to read, not a chip to click. */}
      <ShareLinkInventory org={slug} canShare={canShare} />

      {canBrand && <BrandingSettings slug={slug} initial={branding ?? { brandName: null, brandColor: null, logoUrl: null }} />}

      {/* A second route to the same stage's fixed-window sibling; the next move below stays alone. */}
      <nav aria-label="Related views" className="flex justify-end">
        <Link href={orgTabHref(slug, "digest")} className="focus-ring type-caption text-accent transition hover:text-white">
          Weekly digest →
        </Link>
      </nav>
      <NextMoveLink href={orgTabHref(slug, "overview")} to="overview" />
    </div>
  );
}
