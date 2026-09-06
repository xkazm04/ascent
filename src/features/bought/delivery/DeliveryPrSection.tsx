// The Delivery tab's "Pull request signals" section — extracted out of DeliveryCorePanel so that
// file stays under the 200-LOC cap (AGENTS.md).

import { SectionHeader } from "@/components/org/shared/ui";
import { PrSignalsBand } from "./PrSignalsBand";
import { PrRepoTable } from "./PrRepoTable";
import { prSectionBasisLine } from "./prBasis";
import type { OrgPrSignals } from "@/lib/db";

export function DeliveryPrSection({ pr }: { pr: OrgPrSignals }) {
  return (
    <div>
      {/* `totalPrs` / `repos` describe the fleet's COVERAGE, not any one rate's denominator — the old
          headline read as though all ten percentages below shared them. Each cell now names its own
          population (prBasis), and this line says so instead of implying a shared basis. */}
      <SectionHeader
        title="Pull request signals"
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
            title="By repository"
            description="Riskiest first: lowest review coverage, then slowest merges. Each rate carries its own denominator (hover a cell); the PRs column is the analyzed count, not every rate's population. Click a repo for its full report."
          />
          <div className="mt-3">
            <PrRepoTable rows={pr.perRepo} />
          </div>
        </div>
      )}
    </div>
  );
}
