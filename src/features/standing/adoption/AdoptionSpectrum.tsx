// AdoptionSpectrum — the org's contributor population as a CURVE, not three counts.
//
// It used to be one segmented bar under the sentence "Every contributor, by how much of their own
// recent work is AI-attributed" — a shape described in words above a bar that could not show the
// shape. `AdoptionCurve` draws it: three measured thresholds, a hatched envelope where the producer
// buckets rather than observes, and the org's commit-weighted share as a reference tick on the same
// axis. The follow-up links below the chart are affordances, not chrome, so they stay. Server-safe.

import Link from "next/link";
import { orgTabHref } from "@/lib/org/orgTabs";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { DEFAULT_BASE, Legend, WhyChip } from "@/components/org/viz";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { AdoptionCurve } from "./AdoptionCurve";
import { buildAdoptionCurve } from "./adoptionCurveModel";
import { CURVE_HINT } from "./adoptionHints";

/**
 * The one adoption paint. Adoption is not a maturity grade — low adoption is an expected early
 * baseline, not a defect — so it reads from the BRAND token rather than the red→green ramp, and never
 * from a hand-picked hex (§2.5). It replaced a three-key `BAND` map of literal hexes whose keys the
 * segmented bar needed and the curve does not. Exported: the headline tiles paint from it too.
 */
export const ADOPTION_TINT = DEFAULT_BASE;

/**
 * Back-compat alias. `src/features/shared/practices` imports `BAND.some` for the same reason (a
 * reading, not a grade), and this directory does not own that one. `var(--color-accent)` IS the
 * `#3b9eff` the old literal held — the value is identical, only its source moved to the token.
 * @deprecated Prefer `ADOPTION_TINT`.
 */
export const BAND = { some: ADOPTION_TINT } as const;

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
  /** Commit-weighted org AI share — the reference tick on the curve's threshold axis. */
  orgAiShare: number;
  knowledgeLeader: AdoptionOverview["knowledgeLeader"];
  slug: string;
  /** True when the enablement cohort is non-empty, so the "none" follow-up can deep-link to the
   *  Contributors tab's "Who to enable next" table. False (an empty cohort, or a population below the
   *  naming floor) renders the same sentence as plain text — never a link to a section that isn't there. */
  showEnablementLink: boolean;
}) {
  const model = buildAdoptionCurve(distribution, total, orgAiShare);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Adoption spread"
        right={<WhyChip hint={CURVE_HINT} label="how the spread is measured" align="end" />}
      />

      <AdoptionCurve model={model} className="mt-4" />

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
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-divider pt-3 type-mono-sm text-slate-500">
          {distribution.none > 0 &&
            (showEnablementLink ? (
              // Cross-TAB now: the "Who to enable next" table moved to Contributors (2026-08-19), so
              // this is `?tab=contributors#enablement` rather than a same-page anchor. The <details>
              // it lands on carries scroll-mt-24 to clear the sticky header.
              <Link href={`${orgTabHref(slug, "contributors")}#enablement`} className="transition hover:text-accent">
                → {distribution.none} contributor{distribution.none === 1 ? " has" : "s have"} no AI-attributed commits: see who to enable next on Contributors
              </Link>
            ) : (
              <span>
                {distribution.none} contributor{distribution.none === 1 ? " has" : "s have"} no AI-attributed commits yet
              </span>
            ))}
          {knowledgeLeader && (
            <Link href={orgTabHref(slug, "teams")} className="transition hover:text-accent">
              → most AI-attributed team: <span className="text-slate-300">{knowledgeLeader.name}</span> · {knowledgeLeader.aiCommitShare}% · Teams
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
