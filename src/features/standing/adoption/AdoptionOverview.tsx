// The composition of the Adoption panel. Overview and the same brief; what changes is the
// structure: a masthead whose statement IS the headline reading (the org's commit-weighted AI share, with its
// population), the spread curve in a ruled Frame, then champions and teams side by side and the delivery
// context, instead of a tile ledger over a stack of cards.
import { Caption, Masthead, type MastheadFigure } from "@/components/kit";
import { CopyForLlm } from "@/components/CopyForLlm";
import { WhyChip } from "@/components/shared/viz";
import { AdoptionSpectrum } from "./AdoptionSpectrum";
import { Champions, Teams } from "./AdoptionPeople";
import { DeliveryContext, ToolFootprint } from "./AdoptionContext";
import { ATTRIBUTION_HINT, DENOMINATOR_HINT } from "./adoptionHints";
import type { AdoptionViewProps } from "./adoptionViewProps";

const WINDOW_NOTE = "Latest-scan snapshot · the period selector does not apply";

export function adoptionView({ a, slug, filterBar, md }: AdoptionViewProps) {
  const d = a.delivery;
  const showEnablement = a.enablement.length > 0;
  const figures: MastheadFigure[] = [
    {
      label: "AI-active contributors",
      value: `${a.contributors.aiActive}/${a.contributors.total}`,
      detail: `${a.contributors.aiActiveShare}% of contributors`,
    },
    { label: "AI-involved PRs", value: d ? `${d.aiInvolvedRate}%` : "—", detail: d ? `${d.prs} PRs analyzed` : "no PR data" },
    {
      label: "AI PRs human-reviewed",
      value: d?.aiGovernedRate != null ? `${d.aiGovernedRate}%` : "—",
      detail: "governance on AI-involved PRs",
    },
  ];
  return (
    <div data-role="adoption-v2" className="space-y-8">
      <Masthead
        eyebrow="AI adoption"
        statement={`${a.orgAiShare}% of commits`}
        named="carry an AI trace."
        lede={
          <>
            {a.orgCommits != null ? `Commit-weighted, of ${a.orgCommits.toLocaleString()} commits. ` : "Commit-weighted. "}
            {WINDOW_NOTE}.
          </>
        }
        figures={figures}
        aside={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {filterBar}
            <WhyChip hint={ATTRIBUTION_HINT} label="how AI attribution is read" align="end" />
            <CopyForLlm text={md} label="Copy adoption brief for LLM" title="Copy the adoption brief into Claude Code for an enablement plan" />
          </div>
        }
      />
      {a.orgCommits == null && (
        <p className="flex items-center gap-2">
          <Caption>Commit total withheld below the naming floor</Caption>
          <WhyChip hint={DENOMINATOR_HINT} label="withheld commit total" />
        </p>
      )}
      <AdoptionSpectrum
        distribution={a.distribution}
        total={a.contributors.total}
        orgAiShare={a.orgAiShare}
        knowledgeLeader={a.knowledgeLeader}
        slug={slug}
        showEnablementLink={showEnablement}
      />
      {a.tools.length > 0 && <ToolFootprint tools={a.tools} />}
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        <Champions champions={a.champions} totalContributors={a.contributors.total} slug={slug} />
        <Teams teams={a.teams} pairing={a.teamPairing} slug={slug} />
      </div>
      <DeliveryContext delivery={d} slug={slug} />
    </div>
  );
}
