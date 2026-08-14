// Leaderboard table — the most AI-native public repos, ranked by overall maturity score with a full
// per-dimension (D1..D9) breakdown plus the average. The richer, full-width sibling of the landing's
// "register" (which surfaces only five headline dimensions). Each row deep-links to the public report
// (no auth — every public scan is open); a trailing icon opens the repo on GitHub in a new tab.
//
// Presentational + pure helpers only, so it stays a server component (no "use client").

import Link from "next/link";
import type { RegisterEntry } from "@/lib/register/data";
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

/**
 * `ranked: false` draws the SAME table with no rank numbers — the shape the register's "not
 * independently scored" section uses. A mock-engine row must never wear a board position, so the rank
 * cell becomes an em dash rather than a number, and every row carries the `demo` qualifier below.
 */
export function LeaderboardTable({
  rows,
  startRank = 1,
  ranked = true,
}: {
  rows: RegisterEntry[];
  /** 1-based position of `rows[0]` on the whole board — the pager's page offset. */
  startRank?: number;
  ranked?: boolean;
}) {
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
          const rank = startRank + i;
          return (
            <li key={c.fullName} className={`group relative py-3.5 transition hover:bg-white/[0.02] ${GRID}`}>
              <span
                className={`text-center font-mono text-sm tabular-nums ${
                  ranked && rank <= 3 ? "font-bold text-accent" : "text-slate-600"
                }`}
                title={ranked ? undefined : "Not ranked. This score came from the deterministic preview rubric."}
              >
                {ranked ? String(rank).padStart(2, "0") : "—"}
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
                  {/* Crawl path into the owner's public scorecard. Dynamic per-owner routes can't be
                      enumerated in sitemap.ts, so this link is how they get discovered at all. It sits
                      above the stretched row overlay (relative z-10) or the report link would eat it. */}
                  <Link
                    href={`/scorecard/${c.owner}`}
                    className="focus-ring relative z-10 rounded-sm underline decoration-dotted underline-offset-2 transition hover:text-accent"
                    title={`Public scorecard for ${c.owner}`}
                  >
                    {c.owner}
                  </Link>{" "}
                  · {c.levelName} · {timeAgo(c.scannedAt)}
                  {/* Provenance, carried onto the public surface exactly as the README badge carries
                      it: a deterministic-rubric score is a preview, never a rating. Never silent. */}
                  {!c.verified && (
                    <span
                      className="ml-2 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300/90"
                      title="Scored by the deterministic preview rubric. No model contributed. Not ranked."
                    >
                      demo
                    </span>
                  )}
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
