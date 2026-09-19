// The Delivery tab's "Branch governance" section — extracted out of DeliveryCorePanel so that file
// stays under the 200-LOC cap (AGENTS.md).
//
// The header used to explain the panel before the reader had looked at it ("Guardrails on the default
// branch (from branch protection & rulesets), across N repos. Gaps first; the governed tail is
// folded."). What the panel actually shows now sits at the top as a shape: which guardrail each
// at-risk repo is missing, riskiest first, with a PR rule that requires zero approvals drawn as
// `declared` rather than counted as governance (§2.2, §2.4).

import { SectionHeader, Tile, TILE_LEDGER } from "@/components/org/shared/ui";
import { WhyChip } from "@/components/org/viz";
import { GovernanceTable, isGoverned } from "./GovernanceTable";
import { GovernanceGapMatrix } from "./GovernanceGapMatrix";
import { governanceGapRows } from "./governanceGaps";
import { scoreHex } from "@/lib/ui";
import type { OrgGovernance } from "@/lib/db";

/** (D) The demoted "from branch protection & rulesets" provenance line. */
const SOURCE_HINT =
  "Read from each repo's branch protection and rulesets at its last scan — the gaps are listed first and the fully governed tail is folded below.";

export function DeliveryGovernanceSection({ gov }: { gov: OrgGovernance }) {
  const gaps = gov.perRepo.filter((r) => !isGoverned(r));
  const rows = governanceGapRows(gaps);
  const overflow = gaps.length - rows.length;

  return (
    <div id="governance" className="scroll-mt-24">
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            Branch governance
            <WhyChip hint={SOURCE_HINT} label="where these guardrails are read from" />
          </span>
        }
        description={`${gov.repos} repo${gov.repos === 1 ? "" : "s"} · default branch`}
      />

      {/* First sight is graphical: who is missing what. */}
      {rows.length > 0 && (
        <div className="mt-3">
          <GovernanceGapMatrix rows={rows} />
          {overflow > 0 && (
            <p className="mt-1 type-mono-sm text-slate-600">
              + {overflow} more repo{overflow === 1 ? "" : "s"} with gaps, in the table below
            </p>
          )}
        </div>
      )}

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
