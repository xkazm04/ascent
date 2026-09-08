// The Delivery tab's "Pull request signals" section — extracted out of DeliveryCorePanel so that
// file stays under the 200-LOC cap (AGENTS.md).
//
// Two sentences left this file in the /org redesign, and neither was deleted. "Each rate below names
// its own population" became a `WhyChip` beside the header (the per-cell basis was already rendered;
// the sentence was only pointing at it). "Riskiest first: lowest review coverage, then slowest
// merges" became `ReviewCoverageStrip` — the ordering is now a shape with the below-target tail
// bracketed, so the reader sees the risk ranking instead of being told the rows are sorted.

import { SectionHeader } from "@/components/org/shared/ui";
import { WhyChip } from "@/components/org/viz";
import { PrSignalsBand, REVIEW_TARGET } from "./PrSignalsBand";
import { PrRepoTable } from "./PrRepoTable";
import { ReviewCoverageStrip } from "./ReviewCoverageStrip";
import { BASIS_HINT, PRS_COLUMN_HINT, prSectionBasisLine } from "./prBasis";
import type { OrgPrSignals } from "@/lib/db";

export function DeliveryPrSection({ pr }: { pr: OrgPrSignals }) {
  return (
    <div>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            Pull request signals
            <WhyChip hint={BASIS_HINT} label="what each rate is measured over" />
          </span>
        }
        // §2.3 — unit and coverage only. `totalPrs` / `repos` describe the fleet's COVERAGE, not any
        // one rate's denominator; each cell states its own population (prBasis).
        description={prSectionBasisLine(pr.totalPrs, pr.repos)}
        right={
          pr.tools.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5 type-mono-sm text-slate-500">
              tools:
              {pr.tools.map((t) => (
                <span key={t.name} className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300">
                  {t.name} {t.count}
                </span>
              ))}
            </span>
          ) : undefined
        }
      />
      <div className="mt-3">
        <PrSignalsBand pr={pr} />
      </div>

      {/* The averages above are only readable with the spread behind them: who drags the mean. */}
      {pr.perRepo.length > 0 && (
        <div id="per-repo" className="mt-5 scroll-mt-24">
          <SectionHeader
            size="sm"
            title={
              <span className="inline-flex items-center gap-2">
                By repository
                <WhyChip hint={PRS_COLUMN_HINT} label="the PRs column" align="start" />
              </span>
            }
          />
          {/* First sight is graphical: the risk ordering the table below follows, drawn. */}
          <div className="mt-3">
            <ReviewCoverageStrip
              rows={pr.perRepo.map((r) => ({ name: r.name, rate: r.reviewedRate }))}
              target={REVIEW_TARGET}
            />
          </div>
          <div className="mt-4">
            <PrRepoTable rows={pr.perRepo} />
          </div>
        </div>
      )}
    </div>
  );
}
