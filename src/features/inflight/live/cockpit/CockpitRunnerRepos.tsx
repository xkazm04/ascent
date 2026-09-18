"use client";

// THE RUNNER'S REPOS — one row per repo in scope, from `repoState` (spark theater-upgrade, 2026-09-18).
//
// A runner pauses per repo as well as as a whole: three failed lanes, a branch conflict, a failed
// dependency install, or the dry backoff after runs that closed nothing. The row says WHICH, the
// runner's own sentence about why (the conflicting files, the failing check), and until when — a
// pause with no time is one only the operator lifts. Streaks are printed while they are counting,
// because "2 failed in a row" is the warning before the pause, not after it.
//
// RESUME is here as well as on the Ledger, through the same client function (`resumeRunnerRepo` in
// driveClient.ts). It is offered on every paused repo, the dry backoff included — waking a repo early
// is the operator's call — and never on a runner that has ended, which has nothing to resume into.

import { InlineEmpty, TILE_LEDGER } from "@/components/org/shared/ui";
import type { RunnerRepoRow } from "./runnerModel";

export interface CockpitRunnerReposProps {
  rows: RunnerRepoRow[];
  /** Lift one repo's pause. Absent = no Resume buttons (the runner is not live). */
  onResume?: (repo: string) => void;
  busy?: boolean;
}

export function CockpitRunnerRepos({ rows, onResume, busy = false }: CockpitRunnerReposProps) {
  if (rows.length === 0) return <InlineEmpty>No repos in scope.</InlineEmpty>;
  return (
    <ul data-testid="runner-repos" className={`mt-3 ${TILE_LEDGER}`}>
      {rows.map((r) => (
        <li key={r.repo} data-repo={r.repo} className="bg-ink px-4 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 truncate type-caption text-slate-300" title={r.repo}>
              {r.short}
              {r.base && <span className="ml-1.5 text-slate-600">→ {r.base}</span>}
              {r.ahead != null && r.ahead > 0 && <span className="ml-1.5 tabular-nums text-slate-500">{r.ahead} ahead</span>}
            </span>
            {r.pause ? (
              <span className="type-caption text-warn">
                paused · {r.pause}
                {r.until && <span className="tabular-nums"> until {r.until}</span>}
              </span>
            ) : (
              <span className="type-caption text-slate-500">working</span>
            )}
          </div>
          {r.note && <p className="mt-1 type-micro leading-relaxed text-slate-400">{r.note}</p>}
          {r.streaks && <p className="mt-1 type-micro tabular-nums text-slate-500">{r.streaks}</p>}
          {r.resumable && onResume && (
            <button
              type="button"
              onClick={() => onResume(r.repo)}
              disabled={busy}
              aria-label={`Resume ${r.repo}`}
              className="focus-ring mt-2 rounded-md border border-accent/60 px-2.5 py-1 type-label tracking-[0.18em] text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Resume
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
