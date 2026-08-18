// The governance tab's single data-bearing region: resolves scope, builds the fleet gate overview,
// and renders every card. One panel/one Suspense boundary (GovernanceTab) because every card below
// derives from the same `buildGovernanceOverview` read — splitting it into further boundaries would
// just add latency-matched waits, not independent streaming. Extracted from the old
// src/app/org/[slug]/governance/page.tsx (docs/ORG-TABS-REFACTOR.md).

import { buildGovernanceOverview, ciActionYaml, governanceMarkdown } from "@/lib/org/governance";
import { SectionEmpty, SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { CopyForLlm } from "@/components/CopyForLlm";
import { resolveOrgScope } from "@/lib/org/scope";
import { hasOrgRole } from "@/lib/authz";
import { scoreHex } from "@/lib/ui";
import { GovernancePolicyCard } from "./GovernancePolicyCard";
import { GovernanceFailReasonsCard } from "./GovernanceFailReasonsCard";
import { GovernanceFailingReposCard } from "./GovernanceFailingReposCard";
import { GovernanceClosestToGreenCard } from "./GovernanceClosestToGreenCard";
import { GovernanceCiCard } from "./GovernanceCiCard";
import { EvidencePackCard } from "./EvidencePackCard";
// W3: the AI-stance prototype switcher is retired — the Perimeter is a real section below the gate
// cards, fed by the persisted OrgAiStance + per-repo compliance from existing scan data.
import { StanceSection } from "./stance/StanceSection";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function GovernancePanel({ slug, sp }: { slug: string; sp: SearchParams }) {
  // Segment + tech-stack scope (?segment=/?stack=), matching adoption/backlog/contributors/delivery/
  // teams: a lead who filtered the fleet elsewhere used to land here on an unfiltered fleet gate with
  // no control to explain why. The scope narrows WHO is measured; the policy stays org-wide.
  const { barProps, segmentId, techGroupId } = await resolveOrgScope(slug, sp);
  const scoped = segmentId != null || techGroupId != null;

  // Owners can edit the persisted gate policy (GATE-1); everyone sees the active policy read-only.
  // The overview hands back the policy row it already read (g.savedPolicy), so the panel doesn't
  // issue a SECOND getOrgGatePolicy — the role check runs alongside the overview instead of behind it.
  const [g, canEdit] = await Promise.all([buildGovernanceOverview(slug, segmentId, techGroupId), hasOrgRole(slug, "owner")]);

  const filterBar = <ScopeFilterBar {...barProps} />;

  if (!g) {
    // The stance still renders without scans: it is persisted org CONFIG, not scan-derived — the
    // publish CTA / editor is exactly what a fresh org should meet here.
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
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title="Governance"
          description="One maturity gate, applied as policy-as-code to every repo in the fleet. See who clears the bar, where the rest fall short, and copy the snippet that enforces the exact same gate in CI."
        />
        <div className="flex flex-wrap items-center gap-2">
          {filterBar}
          <CopyForLlm text={md} label="Copy governance brief for LLM" />
        </div>
      </div>

      <div className={TILE_GRID}>
        <Tile label="Gate pass rate" value={`${g.passRate}%`} color={passColor} sub={`${g.passing}/${g.scanned} repos`} />
        <Tile label="Passing" value={String(g.passing)} color="#16a34a" sub="clear the gate" />
        <Tile label="Failing" value={String(g.failing)} color={g.failing ? "#ef4444" : "#16a34a"} sub="below the bar" />
        <Tile label="Repos scanned" value={String(g.scanned)} sub="in the fleet" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GovernancePolicyCard slug={slug} policyText={g.policyText} canEdit={canEdit} gatePolicy={g.savedPolicy} />
        <GovernanceFailReasonsCard g={g} />
      </div>

      <GovernanceFailingReposCard slug={slug} g={g} />
      <GovernanceClosestToGreenCard slug={slug} g={g} />
      <GovernanceCiCard gateQuery={g.gateQuery} snippet={snippet} />

      {/* W2 — the evidence pack sits with the stance and the gate policy on purpose: this is where an
          org declares its review controls, so it is where it should be able to file proof they
          operated. `canEdit` is the owner check the panel already made; named evidence is owner-only. */}
      <EvidencePackCard slug={slug} canExportNamed={canEdit} />

      <StanceSection slug={slug} canEdit={canEdit} />
    </div>
  );
}
