// The Delivery tab's "Branch governance" section — extracted out of DeliveryCorePanel so that file
// stays under the 200-LOC cap (AGENTS.md).

import { SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { GovernanceTable } from "./GovernanceTable";
import { scoreHex } from "@/lib/ui";
import type { OrgGovernance } from "@/lib/db";

export function DeliveryGovernanceSection({ gov }: { gov: OrgGovernance }) {
  return (
    <div id="governance" className="scroll-mt-24">
      <SectionHeader
        title="Branch governance"
        description={`Guardrails on the default branch (from branch protection & rulesets), across ${gov.repos} repos. Gaps first; the governed tail is folded.`}
      />
      <div className={`mt-3 ${TILE_LEDGER} grid-cols-2 sm:grid-cols-4`}>
        <Tile label="Protect main" value={`${gov.protectedRate}%`} color={scoreHex(gov.protectedRate)} />
        <Tile label="Require review" value={`${gov.requireReviewRate}%`} sub="≥1 approving review" color={scoreHex(gov.requireReviewRate)} />
        {/* "Required status checks", not "Require checks" (UAT PRIYA-L1-07): this is the
            branch-protection rate — the share of repos whose default branch requires status checks
            to pass. Governance's `GatePolicy.requireChecks` is a different thing two tabs away
            (doctor control ids that must not be reported failing), and the two must not share a
            phrase on a dashboard a lead cites to an auditor. */}
        <Tile
          label="Required status checks"
          value={`${gov.requireChecksRate}%`}
          sub="branch protection"
          color={scoreHex(gov.requireChecksRate)}
        />
        <Tile label="Signed commits" value={`${gov.signedRate}%`} color={scoreHex(gov.signedRate)} />
      </div>
      <div className="mt-3">
        <GovernanceTable gov={gov} />
      </div>
    </div>
  );
}
