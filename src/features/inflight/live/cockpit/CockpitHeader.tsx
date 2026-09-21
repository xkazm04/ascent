"use client";

// The cockpit masthead: what you are looking at, whether anything is running, and the ONE primary
// action available right now. The wall toggle is a plain link (not a mode toggle in state) so the
// view the operator chose survives a reload and can be bookmarked — `?view=wall` is the wall.
//
// THE LIVE VIEW SWITCH (spark theater-upgrade, 2026-09-18) sits beside it: Theater · Ledger · Cockpit,
// the shared `LiveViewSwitch` mounted as-is (current = cockpit), never a fork of it — the three views
// read one standing runner, and a second copy of the switch is how one of them stops being reachable.
//
// THE GEAR IS THE RUN'S SETUP, and it is here rather than in the rail because setup is a property of
// the DEPLOYMENT'S NEXT RUN, not of the current selection: it survives every lasso, it is read by Run,
// Drive and the standing runner, and an operator touches it once a session. Its title carries the
// armed configuration, so what the dialog holds is legible without opening it. It is offered only to
// someone who could actually dispatch — a dialog that arms a run a viewer may not start is a dialog
// that lies.
//
// STOP SAYS WHAT IT STOPS. While a standing runner is on, Stop stops the runner (the drive's stop),
// and its label and wind-down caption are the runner's (`stopLabel`, `stopCaption`) — a waiting runner
// stops at its next beat, which the run's "in-flight lanes finish their session" would misstate.

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { LiveViewSwitch } from "../LiveViewSwitch";
import { GearIcon } from "./CockpitGearIcon";
import { stoppingCaption, type LoopRunRecord } from "./loopTypes";

export interface CockpitHeaderProps {
  /** The org — the view switch's theater link needs it. */
  slug: string;
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
  /** `?view=ledger` / `?view=cockpit`, the tab's other params preserved (`liveViewHref`). */
  ledgerHref: string;
  cockpitHref: string;
  /** Open the run-setup dialog. Absent for a viewer who cannot dispatch — the gear is then not drawn. */
  onOpenSetup?: () => void;
  /** The armed configuration, one line, for the gear's tooltip (`dialsSummary`). */
  setupSummary?: string;
  onStop?: () => void;
  /** What Stop stops — "Stop runner" while a standing runner is on. */
  stopLabel?: string;
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
  /** The wind-down, in the stopped thing's own words (the runner's). Absent = the run's caption. */
  stopCaption?: string | null;
}

const LINK = "focus-ring rounded-md border border-divider type-label tracking-[0.18em] text-slate-400 transition hover:border-accent hover:text-white";

export function CockpitHeader({
  slug,
  fleetCount,
  active,
  laneCount,
  live,
  driveCaption = null,
  wallHref,
  ledgerHref,
  cockpitHref,
  onOpenSetup,
  setupSummary,
  onStop,
  stopLabel = "Stop",
  stopping = false,
  stopRequested = false,
  stopHorizonMs = null,
  stopCaption = null,
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
        {live && stopRequested && <p className="mt-1 type-caption text-warn">{stopCaption ?? stoppingCaption(stopHorizonMs)}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <LiveViewSwitch slug={slug} current="cockpit" ledgerHref={ledgerHref} cockpitHref={cockpitHref} />
        {onOpenSetup && (
          <button
            type="button"
            onClick={onOpenSetup}
            data-testid="cockpit-setup-gear"
            aria-label="Run setup"
            title={setupSummary ? `Run setup — ${setupSummary}` : "Run setup"}
            className={`${LINK} p-1.5`}
          >
            <GearIcon />
          </button>
        )}
        <Link href={wallHref} className={`${LINK} px-3 py-1.5`}>
          Wall
        </Link>
        {live && onStop && (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping || stopRequested}
            title={stopCaption ?? undefined}
            className="focus-ring rounded-md border border-danger/60 px-3 py-1.5 type-label tracking-[0.18em] text-danger transition hover:bg-danger/10 disabled:opacity-50"
          >
            {stopping || stopRequested ? "Stopping…" : stopLabel}
          </button>
        )}
      </div>
    </div>
  );
}
