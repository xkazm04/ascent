// Leaderboard table — the most AI-native public repos, ranked by overall maturity score with a full
// per-dimension (D1..D9) breakdown plus the average. The richer, full-width sibling of the landing's
// "register" (which surfaces only five headline dimensions). Each row deep-links to the public report
// (no auth — every public scan is open); a trailing icon opens the repo on GitHub in a new tab.
//
// Presentational + pure helpers only, so it stays a server component (no "use client").

import Link from "next/link";
import type { PublicRepoCard } from "@/lib/db";
import type { DimensionId } from "@/lib/types";
import { DIMENSIONS, DIMENSION_BY_ID } from "@/lib/maturity/model";
import { DIMENSION_SHORT, scoreHex, timeAgo } from "@/lib/ui";
import { GitHubMark } from "@/components/auth/buttonChrome";

// Every rubric dimension, in canonical order — the full per-category breakdown (vs. the register's 5).
const DIMS: DimensionId[] = DIMENSIONS.map((d) => d.id);

// Shared column track. Compact below lg (rank · repo · avg · GitHub); the full nine-dimension
// breakdown reveals at lg, where the columns fit the max-w-6xl page.
const GRID =
  "grid items-center gap-x-2 grid-cols-[1.5rem_minmax(0,1fr)_3rem_1.75rem] lg:gap-x-1.5 lg:grid-cols-[1.75rem_minmax(0,1fr)_repeat(9,2.5rem)_3.5rem_1.75rem]";

/** A single 0..100 score cell, colored by the rubric ramp; an em dash when the scan lacks it. */
function ScoreCell({ score, big = false, className = "" }: { score?: number; big?: boolean; className?: string }) {
  if (score == null) return <span className={`text-center font-mono text-sm text-slate-700 ${className}`}>—</span>;
  return (
    <span
      className={`text-center font-mono font-bold tabular-nums ${big ? "text-lg" : "text-sm"} ${className}`}
      style={{ color: scoreHex(score) }}
    >
      {score}
    </span>
  );
}

export function LeaderboardTable({ rows }: { rows: PublicRepoCard[] }) {
  return (
    <div className="mt-8">
      {/* Column header — aligned to the row track; dimension labels only show where their columns do. */}
      <div className={`${GRID} border-b border-divider pb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500`}>
        <span className="text-center" aria-hidden>
          #
        </span>
        <span>Repository</span>
        {DIMS.map((d) => (
          <span key={d} className="hidden text-center leading-tight lg:block" title={DIMENSION_BY_ID[d].name}>
            {DIMENSION_SHORT[d]}
          </span>
        ))}
        <span className="text-center text-slate-400">Avg</span>
        <span aria-hidden />
      </div>

      <ol className={`divide-y divide-divider/70`}>
        {rows.map((c, i) => {
          const rank = i + 1;
          return (
            <li key={c.fullName} className={`group relative py-3.5 transition hover:bg-white/[0.02] ${GRID}`}>
              <span
                className={`text-center font-mono text-sm tabular-nums ${
                  rank <= 3 ? "font-bold text-accent" : "text-slate-600"
                }`}
              >
                {String(rank).padStart(2, "0")}
              </span>

              <span className="min-w-0">
                {/* Stretched link: the ::after overlay covers the whole row, so clicking anywhere opens
                    the report — except the GitHub icon, which sits above it (relative z-10). */}
                <Link
                  href={c.href}
                  className="focus-ring rounded-sm after:absolute after:inset-0"
                  title={`Read the ${c.fullName} report`}
                >
                  <span className="block truncate text-base font-semibold text-white transition group-hover:text-accent">
                    {c.fullName}
                  </span>
                </Link>
                <span className="font-mono text-xs uppercase tracking-widest text-slate-500">
                  {c.levelName} · {timeAgo(c.scannedAt)}
                </span>
              </span>

              {DIMS.map((d) => (
                <ScoreCell key={d} score={c.dimensions[d]} className="hidden lg:block" />
              ))}

              <ScoreCell score={c.overall} big />

              <a
                href={`https://github.com/${c.fullName}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${c.fullName} on GitHub`}
                aria-label={`Open ${c.fullName} on GitHub (opens in a new tab)`}
                className="focus-ring relative z-10 inline-flex h-7 w-7 items-center justify-center justify-self-center rounded-md text-slate-500 transition hover:bg-white/5 hover:text-white"
              >
                <GitHubMark size={16} />
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
