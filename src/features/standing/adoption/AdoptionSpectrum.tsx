// The adoption spread, composition: the contributor population as the measured curve (AdoptionCurve is
// shared with v1: three measured points, a hatched envelope where nothing was observed, the org share as a
// reference tick), set in a ruled Frame with the follow-up links as plain sentences. Server-safe.
import Link from "next/link";
import { Frame, SectionHead } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import { DEFAULT_BASE, Legend, WhyChip } from "@/components/shared/viz";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { AdoptionCurve } from "./AdoptionCurve";
import { buildAdoptionCurve } from "./adoptionCurveModel";
import { CURVE_HINT } from "./adoptionHints";

export function AdoptionSpectrum({
  distribution,
  total,
  orgAiShare,
  knowledgeLeader,
  slug,
  showEnablementLink,
}: {
  distribution: AdoptionOverview["distribution"];
  total: number;
  orgAiShare: number;
  knowledgeLeader: AdoptionOverview["knowledgeLeader"];
  slug: string;
  /** True when the enablement cohort is non-empty, so the "none" follow-up can deep-link to Contributors. */
  showEnablementLink: boolean;
}) {
  const model = buildAdoptionCurve(distribution, total, orgAiShare);
  return (
    <Frame aria-label="Adoption spread">
      <SectionHead
        eyebrow="Adoption spread"
        title="How far the habit has"
        named="reached."
        actions={<WhyChip hint={CURVE_HINT} label="how the spread is measured" align="end" />}
      />
      <AdoptionCurve model={model} className="mt-5" />
      <Legend
        className="mt-3"
        states={["measured", "not-judged"]}
        baseColor={DEFAULT_BASE}
        extra={[
          {
            id: "org-share",
            label: `Org share ${orgAiShare}%`,
            swatch: (
              <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden className="shrink-0">
                <line x1={7} y1={1} x2={7} y2={13} stroke={DEFAULT_BASE} strokeWidth={1} strokeOpacity={0.45} />
              </svg>
            ),
            hint: "Commit-weighted across every contributor, plotted on the same threshold axis as the curve.",
          },
        ]}
      />
      {(distribution.none > 0 || knowledgeLeader) && (
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 border-t border-divider pt-4 type-body-sm text-slate-300">
          {distribution.none > 0 &&
            (showEnablementLink ? (
              <Link href={`${orgTabHref(slug, "contributors")}#enablement`} className="focus-ring hover:text-white">
                → {distribution.none} contributor{distribution.none === 1 ? " has" : "s have"} no AI-attributed commits: see who to enable next on Contributors
              </Link>
            ) : (
              <span>
                {distribution.none} contributor{distribution.none === 1 ? " has" : "s have"} no AI-attributed commits yet
              </span>
            ))}
          {knowledgeLeader && (
            <Link href={orgTabHref(slug, "teams")} className="focus-ring hover:text-white">
              → most AI-attributed team: <span className="text-white">{knowledgeLeader.name}</span> · {knowledgeLeader.aiCommitShare}% · Teams
            </Link>
          )}
        </div>
      )}
    </Frame>
  );
}
