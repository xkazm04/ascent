// Altimeter composition of the governance tab. Moved unchanged from GovernancePanel so a Prism
// layout can exist beside it. Same props, same cards, same copy.
import { SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { CopyForLlm } from "@/components/CopyForLlm";
import { scoreHex } from "@/lib/ui";
import { ciActionYaml, governanceMarkdown } from "@/lib/org/governance";
import { GovernancePolicyCard } from "./GovernancePolicyCard";
import { GovernanceFailReasonsCard } from "./GovernanceFailReasonsCard";
import { GovernanceFailingReposCard } from "./GovernanceFailingReposCard";
import { GovernanceCiCard } from "./GovernanceCiCard";
import { EvidencePackCard } from "./EvidencePackCard";
import { ControlTimelineCard } from "./ControlTimelineCard";
import { StanceSection } from "./stance/StanceSection";
import type { GovernanceViewProps } from "./governanceView";

export function GovernanceViewV1({ slug, sp, g, canEdit, scoped, filterBar }: GovernanceViewProps) {
  if (!g) {
    return (
      <div className="space-y-6">
        <div className="mb-4 flex justify-end">{filterBar}</div>
        <SectionEmpty>
          {scoped
            ? "No scanned repositories for this filter. Pick another segment/stack or clear the filter to evaluate the whole fleet."
            : "No scanned repositories yet. Scan some of this org's repositories to evaluate the fleet against the governance gate."}
        </SectionEmpty>
        <StanceSection slug={slug} canEdit={canEdit} />
      </div>
    );
  }

  const md = governanceMarkdown(g);
  const snippet = ciActionYaml(g.ciWith).join("\n");
  const passColor = scoreHex(g.passRate);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Title only — the standfirst it carried restated what the policy card, the fail-reasons
            card and the CI card each say at the point of use, one screen above any of them. */}
        <SectionHeader title="Governance" />
        <div className="flex flex-wrap items-center gap-2">
          {filterBar}
          <CopyForLlm text={md} label="Copy governance brief for LLM" />
        </div>
      </div>

      <div className={TILE_GRID}>
        {/* Denominator is `assessed`, matching passRate: a repo that scored nothing was never
            judged, and counting it here would state a rate over a population the number is not
            measured across. The unjudged bucket gets its own tile rather than being absorbed. */}
        <Tile label="Gate pass rate" value={`${g.passRate}%`} color={passColor} sub={`${g.passing}/${g.assessed} judged`} />
        <Tile label="Passing" value={String(g.passing)} color="#16a34a" sub="clear the gate" />
        <Tile label="Failing" value={String(g.failing)} color={g.failing ? "#ef4444" : "#16a34a"} sub="below the bar" />
        <Tile label="Repos scanned" value={String(g.scanned)} sub="in the fleet" />
        {g.incomplete > 0 && (
          <Tile label="Not judged" value={String(g.incomplete)} color="#f59e0b" sub="scored nothing" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GovernancePolicyCard slug={slug} policyText={g.policyText} canEdit={canEdit} gatePolicy={g.savedPolicy} />
        <GovernanceFailReasonsCard g={g} />
      </div>

      <GovernanceFailingReposCard slug={slug} g={g} />
      <GovernanceCiCard gateQuery={g.gateQuery} snippet={snippet} />

      {/* W2 — the evidence pack sits with the stance and the gate policy on purpose: this is where an
          org declares its review controls, so it is where it should be able to file proof they
          operated. `canEdit` is the owner check the panel already made; named evidence is owner-only. */}
      <EvidencePackCard slug={slug} canExportNamed={canEdit} sp={sp} />

      {/* MOONSHOT #1 — the observation timeline sits directly BELOW the evidence pack, because it is
          the source the pack's per-item "as of merge" environment is read from. */}
      <ControlTimelineCard slug={slug} />

      <StanceSection slug={slug} canEdit={canEdit} />
    </div>
  );
}
