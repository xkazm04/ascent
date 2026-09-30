// Prism composition. One masthead states the pass rate. Each section is a hairline frame. The CI
// action is the single boxed evidence panel. Shared shaping stays in governanceReasons, evidenceFlow,
// controlTimeline, and the gate-policy hook.
import { ciActionYaml, governanceMarkdown } from "@/lib/org/governance";
import { GovernanceMastheadV2 } from "./governanceMasthead.v2";
import { GovernancePolicyV2 } from "./GovernancePolicy.v2";
import { GovernanceReasonsV2 } from "./GovernanceReasons.v2";
import { GovernanceFailuresV2 } from "./GovernanceFailures.v2";
import { GovernanceCiV2 } from "./GovernanceCi.v2";
import { EvidencePackV2 } from "./EvidencePack.v2";
import { ControlLedgerV2 } from "./ControlLedger.v2";
import { StanceFrameV2 } from "./stance/StanceFrame.v2";
import type { GovernanceViewProps } from "./governanceView";

export function GovernanceViewV2({ slug, sp, g, canEdit, scoped, filterBar }: GovernanceViewProps) {
  return (
    <div data-role="governance-v2" className="space-y-10">
      <GovernanceMastheadV2
        g={g}
        scoped={scoped}
        filterBar={filterBar}
        brief={g ? governanceMarkdown(g) : null}
      />
      {g && (
        <>
          <GovernancePolicyV2 slug={slug} policyText={g.policyText} canEdit={canEdit} gatePolicy={g.savedPolicy} />
          <GovernanceReasonsV2 g={g} />
          <GovernanceFailuresV2 slug={slug} g={g} />
          <GovernanceCiV2 gateQuery={g.gateQuery} snippet={ciActionYaml(g.ciWith).join("\n")} />
          <EvidencePackV2 slug={slug} canExportNamed={canEdit} sp={sp} />
          <ControlLedgerV2 slug={slug} />
        </>
      )}
      <StanceFrameV2 slug={slug} canEdit={canEdit} />
    </div>
  );
}
