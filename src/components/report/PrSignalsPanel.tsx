import type { ScanReport } from "@/lib/types";
import { scoreHex } from "@/lib/ui";

function fmtHours(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return "<1h";
  if (h < 48) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function PrMetric({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="font-mono text-sm uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-xl font-bold tabular-nums" style={{ color: color ?? "#fff" }}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-sm text-slate-500">{hint}</div>}
    </div>
  );
}

export function PrSignalsPanel({ stats }: { stats: NonNullable<ScanReport["prStats"]> }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">Pull request signals</h2>
          <p className="mt-1 text-base text-slate-400">
            How systematically the team ships — from the {stats.analyzed} most recent of {stats.totalCount} PRs.
          </p>
        </div>
        {stats.aiInvolvedRate > 0 && (
          <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-sm text-accent">
            {stats.aiInvolvedRate}% AI-involved
            {stats.aiGovernedRate != null && ` · ${stats.aiGovernedRate}% reviewed`}
          </span>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <PrMetric
          label="Review coverage"
          value={stats.reviewedRate == null ? "n/a" : `${stats.reviewedRate}%`}
          color={stats.reviewedRate == null ? undefined : scoreHex(stats.reviewedRate)}
          hint={stats.reviewedRate == null ? "no human-merged PRs" : "human PRs reviewed"}
        />
        <PrMetric label="Merge rate" value={`${stats.mergeRate}%`} color={scoreHex(stats.mergeRate)} hint="vs closed unmerged" />
        <PrMetric label="Small PRs" value={`${stats.smallPrRate}%`} color={scoreHex(stats.smallPrRate)} hint="≤200 lines" />
        <PrMetric label="Time to merge" value={fmtHours(stats.medianHoursToMerge)} hint="median" />
        <PrMetric label="Time to review" value={fmtHours(stats.medianHoursToFirstReview)} hint="median 1st" />
        <PrMetric label="Revert rate" value={`${stats.revertRate}%`} color={stats.revertRate > 10 ? "#f97316" : "#fff"} hint="reverted PRs" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-sm text-slate-500">
        <span>avg {stats.avgLineChanges} lines · {stats.avgChangedFiles} files</span>
        <span>{stats.avgReviews} reviews / {stats.avgComments} comments per PR</span>
        {stats.botAuthoredRate > 0 && <span>{stats.botAuthoredRate}% bot-authored</span>}
        {stats.tools.length > 0 && (
          <span className="flex items-center gap-1.5">
            tools:
            {stats.tools.map((t) => (
              <span key={t.name} className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300">
                {t.name} {t.count}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
