// Prism composition of the Briefing tab. Altimeter stays in ExecutiveTab.v1. Share and PDF do not use this file.
import { Frame, SectionHead } from "@/components/kit";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { hasBriefingBrand } from "./briefingCards";
import { BrandingSettingsV2 } from "./BrandingSettings.v2";
import { executiveDims } from "./ExecutiveDims.v2";
import { executiveGoals, executiveMovement } from "./ExecutiveLists.v2";
import { executiveBrandStrip, executiveMasthead } from "./ExecutiveMasthead.v2";
import { executivePrior } from "./ExecutivePrior.v2";
import { executiveSignals, executiveTrajectory, executiveValue } from "./ExecutiveReadout.v2";
import { impactLedgerV2 } from "./ImpactLedger.v2";
import { leverageMovesV2 } from "./LeverageMoves.v2";
import { ProgramPanelV2 } from "./ProgramPanel.v2";
import { ShareLinkInventory } from "./ShareLinkInventory";
import type { ExecutiveView } from "./executiveView";

export function executiveEmptyV2() {
  return (
    <div data-role="executive-v2" className="space-y-10">
      <Frame>
        <SectionHead
          eyebrow="Executive briefing"
          title="No scanned repositories yet."
          lede="Scan some of this org's repos to generate an executive briefing."
        />
      </Frame>
    </div>
  );
}

export function executiveV2(v: ExecutiveView) {
  const { briefing } = v;
  const now = briefing.realScoredCount > 0 ? briefing.maturity.overall : null;
  const recs = briefing.recommendations ?? [];
  return (
    <div data-role="executive-v2" className="space-y-10">
      {v.canBrand && hasBriefingBrand(v.branding) ? executiveBrandStrip(v.branding) : null}
      {executiveMasthead(v)}
      {executiveValue(briefing)}
      {v.impact ? impactLedgerV2(v.slug, v.impact, v.period.title) : null}
      <ProgramPanelV2 slug={v.slug} initial={v.program} now={now} />
      {executiveSignals(briefing)}
      {executiveTrajectory(briefing, !!v.period.start)}
      {briefing.priorPeriod ? executivePrior(briefing.priorPeriod, briefing.maturity) : null}
      {recs.length > 0 ? leverageMovesV2(recs, v.slug) : null}
      {executiveDims(briefing.strengths, briefing.risks, briefing.security, v.slug)}
      {executiveMovement(briefing.topGainers, briefing.topRegressions)}
      {executiveGoals(briefing.goals)}
      {/* Owner-only issued-share-link inventory, same component in both compositions. */}
      <ShareLinkInventory org={v.slug} canShare={v.canShare} />
      {v.canBrand ? (
        <BrandingSettingsV2 slug={v.slug} initial={v.branding ?? { brandName: null, brandColor: null, logoUrl: null }} />
      ) : null}
      <NextMoveLink href={orgTabHref(v.slug, "overview")} to="overview" />
    </div>
  );
}
