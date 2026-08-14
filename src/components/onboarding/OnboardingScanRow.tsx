import Link from "next/link";
import { ScorePill } from "@/components/LevelBadge";
import type { LevelId } from "@/lib/types";

export interface ScanRow {
  repo: string;
  level?: LevelId;
  overall?: number;
  error?: string;
  /** Set (e.g. "insufficient_credits") when the server deferred this repo instead of scanning it —
   *  a terminal state distinct from "scanning…" and from an error. */
  skipped?: string;
}

export function ScanRowView({ row, onRetry }: { row: ScanRow; onRetry?: (repo: string) => void }) {
  const done = row.level && typeof row.overall === "number";

  // Only rendered below when `done` is true, so row.level/row.overall are always defined here —
  // matches the original inline badge's guarantee (it was only referenced from the `done` branch too).
  const badge = done && (
    <ScorePill level={row.level as LevelId} overall={row.overall as number} className="px-1.5 py-0.5 font-mono text-sm" />
  );

  // ONB-3: a completed scan is the payoff — let the user drill straight into the report it produced.
  // `row.repo` is the `owner/name` fullName, which is exactly the /report/[owner]/[repo] path.
  if (done && !row.error) {
    return (
      <Link
        href={`/report/${row.repo}?ref=onboarding`}
        className="group flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5 transition hover:border-accent/50 hover:bg-slate-900/70"
        title={`Open the maturity report for ${row.repo}`}
      >
        <span className="flex-1 truncate font-mono text-base text-white">{row.repo}</span>
        <span className="font-mono text-sm text-accent opacity-0 transition group-hover:opacity-100">view report →</span>
        {badge}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5">
      <span className="flex-1 truncate font-mono text-base text-white">{row.repo}</span>
      {row.error ? (
        <>
          <span className="text-sm text-danger">{row.error}</span>
          {/* A terminal error used to be DEAD red text: one failed row out of ten cost the user the
              whole wizard, because the only recovery ("Scan another") resets the run to step one.
              Retry re-runs just this repo through the same import path. */}
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(row.repo)}
              aria-label={`Retry ${row.repo}`}
              className="focus-ring rounded-md border border-divider px-2.5 py-1 text-sm text-slate-300 transition hover:border-accent/50 hover:text-white"
            >
              Retry
            </button>
          )}
        </>
      ) : row.skipped ? (
        <span className="text-sm text-amber-300">skipped (out of credits)</span>
      ) : (
        <span className="text-sm text-slate-500">scanning…</span>
      )}
    </div>
  );
}
