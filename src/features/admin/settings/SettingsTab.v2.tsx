// The Prism (v2) composition of the Settings tab. Same SettingsData, same cards as v1; what changes is the
// structure: a masthead that states where inference runs, then hairline Frames (Account, Where inference
// runs, Bring your own model, Measured quality, Data) instead of a stack of boxed cards. The cards keep their
// own headers; `data-role="settings-v2"` lets kit.css flatten their panel chrome inside a Frame.
// Server-safe; the entry calls this as a function so the placement tests can walk the tree.
import { Frame, SectionHead } from "@/components/kit";
import { LlmProviderSettings } from "./LlmProviderSettings";
import { OpenRouterByomSettings } from "./OpenRouterByomSettings";
import { NebiusByomSettings } from "./NebiusByomSettings";
import { ModelScorecard } from "./ModelScorecard";
import { BYOM_ANCHOR } from "./modelScorecardViz";
import { ProviderBoundaryCard } from "./ProviderBoundaryCard";
import { LaneRoutingCard } from "./LaneRoutingCard";
import { DataErasureCard } from "./DataErasureCard";
import { RetentionCard } from "./RetentionCard";
import { SettingsMastheadV2, settingsAccountV2 } from "./SettingsSummary.v2";
import type { SettingsData } from "./settingsData";

export function settingsV2(d: SettingsData) {
  const { slug, config, retention, laneRouting, planAllowed, encryptionConfigured } = d;
  const byom = { slug, initial: config, planAllowed, encryptionConfigured };
  return (
    <div data-role="settings-v2" className="stagger-children space-y-10">
      <SettingsMastheadV2 d={d} />
      {settingsAccountV2(d)}
      <Frame id="inference" aria-label="Where inference runs">
        <SectionHead eyebrow="Inference" title="Where scans run," named="and who is billed." />
        <div className="mt-5 space-y-8">
          <ProviderBoundaryCard config={config} planAllowed={planAllowed} />
          <LaneRoutingCard routing={laneRouting} />
        </div>
      </Frame>
      <Frame aria-label="Bring your own model">
        <SectionHead eyebrow="Bring your own model" title="Connect a provider," named="one at a time." />
        <div className="mt-5 space-y-8">
          <LlmProviderSettings {...byom} />
          {/* The scorecard's "Use ↑" links land here; the tab owns the anchor so the card stays unaware of it. */}
          <div id={BYOM_ANCHOR} className="scroll-mt-24">
            <OpenRouterByomSettings {...byom} />
          </div>
          <NebiusByomSettings {...byom} />
        </div>
      </Frame>
      <Frame aria-label="Measured model quality">
        <SectionHead eyebrow="Evidence" title="What the models" named="measured." />
        <div className="mt-5">
          <ModelScorecard />
        </div>
      </Frame>
      <Frame aria-label="Data">
        <SectionHead eyebrow="Data" title="What is kept," named="and what can go." />
        <div className="mt-5 space-y-8">
          {/* Both owner-gated by the entry: a non-owner never renders either control. Save never purges. */}
          <RetentionCard slug={slug} initial={retention} />
          <DataErasureCard slug={slug} />
        </div>
      </Frame>
    </div>
  );
}
