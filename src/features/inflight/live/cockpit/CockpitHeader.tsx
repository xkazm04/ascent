"use client";

// The cockpit masthead: what you are looking at, whether anything is running, and the ONE primary
// action available right now. The wall toggle is a plain link (not a mode toggle in state) so the
// view the operator chose survives a reload and can be bookmarked — `?view=wall` is the wall.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { stoppingCaption, type LoopRunRecord } from "./loopTypes";

export interface CockpitHeaderProps {
  /** Repos in the current scope — the caption's denominator. */
  fleetCount: number;
  active: LoopRunRecord | null;
  /** Lanes the active run has on the board right now. */
  laneCount: number;
  live: boolean;
  /** Set while a DRIVE is pulling — it stays live between runs, when `active` is momentarily null. */
  driveCaption?: string | null;
  /** `?view=wall` with the tab's other params preserved. */
  wallHref: string;
  onStop?: () => void;
  /** A request is in flight, or a stop has been asked for and has not landed. Both disable the
   *  button; only the second one gets a caption, because only the second one lasts. */
  stopping?: boolean;
  /** A stop has been REQUESTED on the server and the run is winding down — minutes, not milliseconds.
   *  Distinct from `stopping` (which also covers the button's own fetch) because this is the state
   *  that has to be narrated: PRIYA-L2-C6 watched a run read `RUNNING` for 19m43s after pressing it. */
  stopRequested?: boolean;
  /** The resolved per-session ceiling of the active run, ms — the bound on the wind-down. `null` =
   *  unknown, and the caption then omits the bound rather than inventing one. */
  stopHorizonMs?: number | null;
}

export function CockpitHeader({
  fleetCount,
  active,
  laneCount,
  live,
  driveCaption = null,
  wallHref,
  onStop,
  stopping = false,
  stopRequested = false,
  stopHorizonMs = null,
}: CockpitHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-divider pb-3">
      <div className="min-w-0">
        <Kicker tone="accent">Observatory</Kicker>
        <h2 className="mt-1 type-heading font-semibold tracking-tight text-slate-100">The fleet, in adoption × rigor</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-slate-500">
          <span className="tabular-nums">{fleetCount} repos</span>
          {driveCaption && (
            <span className="inline-flex items-center gap-1.5 text-accent">
              <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="tabular-nums">{driveCaption}</span>
            </span>
          )}
          {live && active ? (
            <span className="inline-flex items-center gap-1.5 text-accent">
              <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="tabular-nums">
                {laneCount} {laneCount === 1 ? "lane" : "lanes"} · cycle {active.cycle}/{active.maxCycles}
              </span>
            </span>
          ) : driveCaption ? null : (
            <span>at rest</span>
          )}
        </p>
        {/* THE WIND-DOWN, NARRATED. A cooperative stop is minutes long, and a run that keeps reading
            `RUNNING` with no explanation is one an operator presses again or writes off as failed
            (PRIYA-L2-C6). In `warn`, not `danger`: winding down as designed is not a fault. */}
        {live && stopRequested && <p className="mt-1 type-caption text-warn">{stoppingCaption(stopHorizonMs)}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={wallHref}
          className="focus-ring rounded-md border border-divider px-3 py-1.5 type-label tracking-[0.18em] text-slate-400 transition hover:border-accent hover:text-white"
        >
          Wall
        </Link>
        {live && onStop && (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping || stopRequested}
            className="focus-ring rounded-md border border-danger/60 px-3 py-1.5 type-label tracking-[0.18em] text-danger transition hover:bg-danger/10 disabled:opacity-50"
          >
            {stopping || stopRequested ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
    </div>
  );
}
