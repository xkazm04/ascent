"use client";

// Profiles and dimension analysis around ONE stack selection, Prism composition. Same props and the same
// useStackSelection as TechStacksAnalysis, so toggling a stack in the rail rescopes the diagnosis below it.
import { Caption, Frame, SectionHead } from "@/components/kit";
import { WhyChip } from "@/components/shared/viz";
import type { SegmentSummary } from "@/lib/db";
import { STACK_SCOPE } from "./analysisScope";
import { StackInsightsV2 } from "./StackInsights.v2";
import { StackProfilesV2 } from "./StackProfiles.v2";
import { useStackSelection } from "./useStackSelection";

export function TechStacksAnalysisV2({ org, stacks, fleet, dims }: { org: string; stacks: SegmentSummary[]; fleet: SegmentSummary | null; dims: string[] }) {
  const { active, hovered, setHovered, toggle, toggleAll, allActive, activeStacks } = useStackSelection(stacks);
  return (
    <div className="space-y-8">
      <Frame aria-label="Stack profiles">
        <SectionHead eyebrow="Profiles" title="The shape of each stack," named="overlaid." />
        <div className="mt-6">
          <StackProfilesV2
            org={org}
            stacks={stacks}
            dims={dims}
            scope={STACK_SCOPE}
            active={active}
            allActive={allActive}
            hovered={hovered}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onHover={setHovered}
          />
        </div>
      </Frame>
      <Frame aria-label="Dimension analysis">
        <SectionHead eyebrow="Analysis" title="Where stacks agree" named="and where they part." />
        <div className="mt-3 flex items-center gap-2">
          <Caption>
            <span className="tabular-nums text-white">{activeStacks.length}</span> of {stacks.length} stacks in scope
          </Caption>
          <WhyChip
            label="analysis scope"
            hint="Toggling a stack in the rail above rescopes every diagnosis, verdict and playbook below it: the selection drives both panels."
          />
        </div>
        <StackInsightsV2 org={org} stacks={activeStacks} fleet={fleet} dims={dims} scope={STACK_SCOPE} />
      </Frame>
    </div>
  );
}
