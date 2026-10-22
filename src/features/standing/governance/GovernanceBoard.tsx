// Composition. One masthead states the pass rate. Each section is a hairline frame. The CI
// action is the single boxed evidence panel. Shared shaping stays in governanceReasons, evidenceFlow,
// controlTimeline, and the gate-policy hook.
import { ciActionYaml, governanceMarkdown } from "@/lib/org/governance";
import { GovernanceMasthead } from "./governanceMasthead";
import { GovernancePolicy } from "./GovernancePolicy";
import { GovernanceReasons } from "./GovernanceReasonsView";
import { GovernanceFailures } from "./GovernanceFailures";
import { GovernanceCi } from "./GovernanceCi";
import { EvidencePack } from "./EvidencePack";
import { ControlLedger } from "./ControlLedger";
import { StanceFrame } from "./stance/StanceFrame";
import type { GovernanceViewProps } from "./governanceView";

export function GovernanceBoard({ slug, sp, g, canEdit, scoped, filterBar }: GovernanceViewProps) {
  return (
    <div data-role="governance-v2" className="space-y-10">
      <GovernanceMasthead
        g={g}
        scoped={scoped}
        filterBar={filterBar}
        brief={g ? governanceMarkdown(g) : null}
      />
      {g && (
        <>
          <GovernancePolicy slug={slug} policyText={g.policyText} canEdit={canEdit} gatePolicy={g.savedPolicy} />
          <GovernanceReasons g={g} />
          <GovernanceFailures slug={slug} g={g} />
          <GovernanceCi gateQuery={g.gateQuery} snippet={ciActionYaml(g.ciWith).join("\n")} />
          <EvidencePack slug={slug} canExportNamed={canEdit} sp={sp} />
          <ControlLedger slug={slug} />
        </>
      )}
      <StanceFrame slug={slug} canEdit={canEdit} />
    </div>
  );
}
