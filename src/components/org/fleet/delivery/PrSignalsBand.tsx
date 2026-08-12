// The PR-signal headline readings as ONE hairline-divided instrument band (the DeliveryStrip /
// TeamsSignals idiom) instead of free-floating Tiles. Fixes the tile grid's failure modes:
// long tracked-out labels wrapping to three lines, values landing at different heights, and eight
// bordered cards' worth of padding for eight numbers. Each cell is label → value+context on one
// baseline → a thin meter (threshold-marked where a target exists), bottom-aligned across the band.
// Server-safe.

import { Meter, fmtHours } from "@/components/org/shared/ui";
import type { OrgPrSignals } from "@/lib/db";
import { scoreHex } from "@/lib/ui";

export const REVIEW_TARGET = 80;

function Cell({
  label,
  value,
  sub,
  color,
  meter,
  threshold,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  /** 0–100 fill for the bottom meter; omit for non-rate readings (renders no bar, keeps the slot). */
  meter?: number;
  threshold?: number;
}) {
  return (
    <div className="-ml-px -mt-px flex flex-col border-l border-t border-divider px-4 py-3">
      <div className="font-mono text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: color ?? "#e2e8f0" }}>
          {value}
        </span>
        {sub && <span className="text-xs text-slate-500">{sub}</span>}
      </div>
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
  return (
    <div className="overflow-hidden rounded-xl border border-divider bg-surface/40">
      <div className="grid grid-cols-2 sm:grid-cols-4">
        <Cell
          label="Review coverage"
          value={pr.avgReviewedRate == null ? "—" : `${pr.avgReviewedRate}%`}
          sub={pr.avgReviewedRate == null ? "no human merges" : `target ≥${REVIEW_TARGET}%`}
          color={pr.avgReviewedRate == null ? undefined : scoreHex(pr.avgReviewedRate)}
          meter={pr.avgReviewedRate ?? undefined}
          threshold={pr.avgReviewedRate == null ? undefined : REVIEW_TARGET}
        />
        <Cell
          label="First review"
          value={fmtHours(pr.typicalHoursToFirstReview)}
          sub={pr.typicalHoursToFirstReview == null ? "no reviews sampled" : "typical wait, per-repo median"}
        />
        <Cell label="Merge rate" value={`${pr.avgMergeRate}%`} color={scoreHex(pr.avgMergeRate)} meter={pr.avgMergeRate} />
        <Cell label="Merge time" value={fmtHours(pr.typicalHoursToMerge)} sub="typical, per-repo median" />
        <Cell
          label="Small PRs"
          value={`${pr.avgSmallPrRate}%`}
          sub="≤200 lines"
          color={scoreHex(pr.avgSmallPrRate)}
          meter={pr.avgSmallPrRate}
        />
        <Cell
          label="Reverts"
          value={pr.avgRevertRate == null ? "—" : `${pr.avgRevertRate}%`}
          sub={pr.avgRevertRate == null ? "not in these scans" : "of PRs — lower is better"}
          color={pr.avgRevertRate == null ? undefined : revertHex(pr.avgRevertRate)}
          meter={pr.avgRevertRate ?? undefined}
        />
        <Cell
          label="AI involved"
          value={`${pr.avgAiInvolvedRate}%`}
          sub="of all PRs"
          color={scoreHex(pr.avgAiInvolvedRate)}
          meter={pr.avgAiInvolvedRate}
        />
        <Cell
          label="AI reviewed"
          value={pr.avgAiGovernedRate == null ? "—" : `${pr.avgAiGovernedRate}%`}
          sub={pr.avgAiGovernedRate == null ? "small sample" : "governed AI"}
          color={pr.avgAiGovernedRate == null ? undefined : scoreHex(pr.avgAiGovernedRate)}
          meter={pr.avgAiGovernedRate ?? undefined}
          threshold={pr.avgAiGovernedRate == null ? undefined : REVIEW_TARGET}
        />
      </div>
    </div>
  );
}
