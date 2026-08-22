"use client";

// The cockpit masthead: what you are looking at, whether anything is running, and the ONE primary
// action available right now. The wall toggle is a plain link (not a mode toggle in state) so the
// view the operator chose survives a reload and can be bookmarked — `?view=wall` is the wall.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import type { LoopRunRecord } from "./loopTypes";

export interface CockpitHeaderProps {
  /** Repos in the current scope — the caption's denominator. */
  fleetCount: number;
  active: LoopRunRecord | null;
  /** Lanes the active run has on the board right now. */
  laneCount: number;
  live: boolean;
  /** `?view=wall` with the tab's other params preserved. */
  wallHref: string;
  onStop?: () => void;
  stopping?: boolean;
}

export function CockpitHeader({ fleetCount, active, laneCount, live, wallHref, onStop, stopping = false }: CockpitHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-divider pb-3">
      <div className="min-w-0">
        <Kicker tone="accent">Observatory</Kicker>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-100">The fleet, in adoption × rigor</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-500">
          <span className="tabular-nums">{fleetCount} repos</span>
          {live && active ? (
            <span className="inline-flex items-center gap-1.5 text-accent">
              <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="tabular-nums">
                {laneCount} {laneCount === 1 ? "lane" : "lanes"} · cycle {active.cycle}/{active.maxCycles}
              </span>
            </span>
          ) : (
            <span>at rest</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={wallHref}
          className="focus-ring rounded-md border border-divider px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-slate-400 transition hover:border-accent hover:text-white"
        >
          Wall
        </Link>
        {live && onStop && (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            className="focus-ring rounded-md border border-danger/60 px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-danger transition hover:bg-danger/10 disabled:opacity-50"
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
    </div>
  );
}
