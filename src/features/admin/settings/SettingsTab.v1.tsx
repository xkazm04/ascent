// The Altimeter (v1) composition of the Settings tab, moved unchanged from SettingsTab.tsx. Pure and
// server-safe: the entry CALLS it as a function (not as an element) so the pinned placement tests can
// still walk the returned element tree.
import { LlmProviderSettings } from "./LlmProviderSettings";
import { OpenRouterByomSettings } from "./OpenRouterByomSettings";
import { NebiusByomSettings } from "./NebiusByomSettings";
import { ModelScorecard } from "./ModelScorecard";
import { BYOM_ANCHOR } from "./modelScorecardViz";
import { ProviderBoundaryCard } from "./ProviderBoundaryCard";
import { LaneRoutingCard } from "./LaneRoutingCard";
import { DataErasureCard } from "./DataErasureCard";
import { RetentionCard } from "./RetentionCard";
import { PlanControl } from "./PlanControl";
import { SectionHeader } from "@/components/org/shared/ui";
import type { SettingsData } from "./settingsData";

export function settingsV1(d: SettingsData) {
  const { slug, config, retention, laneRouting, planAllowed, encryptionConfigured } = d;
  return (
    <div className="space-y-6">
      <SectionHeader title="Settings" description="Owner only" />
      {/* Polar customer portal is owner-only by this tab's gate (absent for everyone else). Free /
          self-host omit the link via portalEnabled=false; the chip still names the current tier. */}
      <PlanControl org={slug} plan={d.plan} enabled={d.planChangesEnabled} portalEnabled={d.portalEnabled} />
      {/* First sight is graphical (§2.2): the boundary/billing/plan comparison the two BYOM cards
          below used to carry as a paragraph each, drawn once, above both. */}
      <ProviderBoundaryCard config={config} planAllowed={planAllowed} />
      <LaneRoutingCard routing={laneRouting} />
      <LlmProviderSettings slug={slug} initial={config} planAllowed={planAllowed} encryptionConfigured={encryptionConfigured} />
      {/* The scorecard's "Use ↑" links land here: the slugs it ranks are OpenRouter slugs. The anchor
          is owned by the tab rather than the card so the card stays reusable and unaware of it. */}
      <div id={BYOM_ANCHOR} className="scroll-mt-24">
        <OpenRouterByomSettings slug={slug} initial={config} planAllowed={planAllowed} encryptionConfigured={encryptionConfigured} />
      </div>
      <NebiusByomSettings slug={slug} initial={config} planAllowed={planAllowed} encryptionConfigured={encryptionConfigured} />
      <ModelScorecard />
      {/* Retention then erasure: both owner-gated by the entry, so a non-owner never renders either
          control (rather than seeing them disabled). Save on RetentionCard never purges. */}
      <RetentionCard slug={slug} initial={retention} />
      <DataErasureCard slug={slug} />
    </div>
  );
}
