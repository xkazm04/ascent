// The PR-signal headline readings as ONE hairline-divided instrument band (the DeliveryStrip /
// TeamsSignals idiom) instead of free-floating Tiles. Fixes the tile grid's failure modes:
// long tracked-out labels wrapping to three lines, values landing at different heights, and eight
// bordered cards' worth of padding for eight numbers. Each cell is label → value+context on one
// baseline → a thin meter (threshold-marked where a target exists), bottom-aligned across the band.
// Server-safe.

import { Meter, fmtHours } from "@/components/org/shared/ui";
import type { OrgPrSignals } from "@/lib/db";
import type { FleetRateId } from "@/lib/db/org-signals";
import { scoreHex } from "@/lib/ui";
import { fleetBasisCopy, medianBasisCopy } from "./prBasis";

export const REVIEW_TARGET = 80;

function Cell({
  label,
  value,
  sub,
  color,
  meter,
  threshold,
  basis,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  /** 0–100 fill for the bottom meter; omit for non-rate readings (renders no bar, keeps the slot). */
  meter?: number;
  threshold?: number;
  /** The rate's own denominator + contributing repo count (prBasis). Omitted for the two
   *  non-rate hour readings, which are medians of medians and have no population to state. */
  basis?: { short: string; full: string } | null;
}) {
  return (
    <div className="-ml-px -mt-px flex flex-col border-l border-t border-divider px-4 py-3">
      <div className="font-mono type-micro uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className="type-figure font-bold" style={{ color: color ?? "#e2e8f0" }}>
          {value}
        </span>
        {sub && <span className="type-note text-slate-500">{sub}</span>}
      </div>
      {/* The basis, stated per cell rather than implied by the section headline: these ten rates do
          not share a denominator, and several rest on a handful of the fleet's repos. The terse form
          is visible; the full sentence rides the title and an sr-only span so a screen reader and a
          hover get the same claim. */}
      {basis && (
        <div className="mt-1 font-mono type-micro tabular-nums text-slate-600" title={basis.full}>
          <span aria-hidden>{basis.short}</span>
          <span className="sr-only">{basis.full}</span>
        </div>
      )}
      <div className="mt-auto pt-2">
        {meter != null && <Meter size="sm" value={meter} color={color} threshold={threshold} />}
      </div>
    </div>
  );
}

/** Revert-rate tone mirrors pulls.ts's stability transform (100 − rate·6): a 5% revert rate is
 *  already a stability problem, so a raw scoreHex(5) — deep red for a LOW number — would invert the
 *  meaning, and scoreHex(100−5) would flatter it. */
const revertHex = (rate: number) => scoreHex(Math.max(0, 100 - rate * 6));

export function PrSignalsBand({ pr }: { pr: OrgPrSignals }) {
  // One lookup per cell, from the basis the producer already publishes (getOrgPrSignals.rateBasis).
  const basis = (id: FleetRateId) => fleetBasisCopy(id, pr.rateBasis?.[id]);
  // The two hour cells are means of per-repo medians, so their basis is the repo count that actually
  // recorded one — counted here from the same rows the table below renders.
  const withFirstReview = pr.perRepo.filter((r) => r.medianHoursToFirstReview != null).length;
  const withMergeTime = pr.perRepo.filter((r) => r.medianHoursToMerge != null).length;
  return (
    <div className="overflow-hidden rounded-xl border border-divider bg-surface/40">
      {/* 10 cells since W2 — 2×5 keeps the band's rows even. */}
      <div className="grid grid-cols-2 sm:grid-cols-5">
        <Cell
          label="Review coverage"
          value={pr.avgReviewedRate == null ? "—" : `${pr.avgReviewedRate}%`}
          sub={pr.avgReviewedRate == null ? "no human merges" : `target ≥${REVIEW_TARGET}%`}
          color={pr.avgReviewedRate == null ? undefined : scoreHex(pr.avgReviewedRate)}
          meter={pr.avgReviewedRate ?? undefined}
          threshold={pr.avgReviewedRate == null ? undefined : REVIEW_TARGET}
          basis={basis("reviewed")}
        />
        <Cell
          label="First review"
          value={fmtHours(pr.typicalHoursToFirstReview)}
          sub={pr.typicalHoursToFirstReview == null ? "no reviews sampled" : "typical wait, per-repo median"}
          basis={medianBasisCopy(withFirstReview, "hours to first review")}
        />
        <Cell
          label="Merge rate"
          value={`${pr.avgMergeRate}%`}
          color={scoreHex(pr.avgMergeRate)}
          meter={pr.avgMergeRate}
          basis={basis("merge")}
        />
        <Cell
          label="Merge time"
          value={fmtHours(pr.typicalHoursToMerge)}
          sub="typical, per-repo median"
          basis={medianBasisCopy(withMergeTime, "hours to merge")}
        />
        <Cell
          label="Small PRs"
          value={`${pr.avgSmallPrRate}%`}
          sub="≤200 lines"
          color={scoreHex(pr.avgSmallPrRate)}
          meter={pr.avgSmallPrRate}
          basis={basis("smallPr")}
        />
        <Cell
          label="Reverts"
          value={pr.avgRevertRate == null ? "—" : `${pr.avgRevertRate}%`}
          sub={pr.avgRevertRate == null ? "not in these scans" : "of PRs (lower is better)"}
          color={pr.avgRevertRate == null ? undefined : revertHex(pr.avgRevertRate)}
          meter={pr.avgRevertRate ?? undefined}
          basis={basis("revert")}
        />
        <Cell
          label="AI involved"
          value={`${pr.avgAiInvolvedRate}%`}
          sub="of all PRs"
          color={scoreHex(pr.avgAiInvolvedRate)}
          meter={pr.avgAiInvolvedRate}
          basis={basis("aiInvolved")}
        />
        <Cell
          label="AI reviewed"
          value={pr.avgAiGovernedRate == null ? "—" : `${pr.avgAiGovernedRate}%`}
          sub={pr.avgAiGovernedRate == null ? "small sample" : "governed AI"}
          color={pr.avgAiGovernedRate == null ? undefined : scoreHex(pr.avgAiGovernedRate)}
          meter={pr.avgAiGovernedRate ?? undefined}
          threshold={pr.avgAiGovernedRate == null ? undefined : REVIEW_TARGET}
          basis={basis("aiGoverned")}
        />
        {/* W2 — trailer-grounded attribution (commit trailers, not self-declared markers). Uncolored
            like "AI involved" would mislead: it's context, not a target, so no scoreHex tone. */}
        <Cell
          label="AI trailers"
          value={pr.avgAiTrailerRate == null ? "—" : `${pr.avgAiTrailerRate}%`}
          sub={pr.avgAiTrailerRate == null ? "not in these scans" : "of merged PRs, from commit trailers"}
          meter={pr.avgAiTrailerRate ?? undefined}
          basis={basis("aiTrailer")}
        />
        <Cell
          label="AI pre-review"
          value={pr.avgAiPreReviewedRate == null ? "—" : `${pr.avgAiPreReviewedRate}%`}
          sub={pr.avgAiPreReviewedRate == null ? "not in these scans" : "AI reviewed before a human"}
          meter={pr.avgAiPreReviewedRate ?? undefined}
          basis={basis("aiPreReviewed")}
        />
      </div>
    </div>
  );
}
