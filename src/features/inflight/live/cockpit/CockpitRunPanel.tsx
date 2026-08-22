"use client";

// The RUN rail — the right panel while a run is in flight. One LaneRail per lane, plus the run's own
// cycle counter and the single action that is legal mid-run: stop after the in-flight lanes finish.
//
// The stop is cooperative by design (the engine lets a lane complete its current phase), so the copy
// says so: killing a `claude -p` session mid-edit would leave a working copy half-changed.

import { Kicker } from "@/components/ui";
import { InlineEmpty, TILE_LEDGER } from "@/components/org/shared/ui";
import { LaneRail } from "./LaneRail";
import type { LoopLaneOutcome, LoopRunDetail } from "./loopTypes";

export interface CockpitRunPanelProps {
  detail: LoopRunDetail | null;
  live: boolean;
  onStop: () => void;
  onRetry: (laneId: string) => void;
  busy?: boolean;
  error?: string | null;
}

const liftOf = (o: LoopLaneOutcome | undefined): number | null =>
  o?.before && o?.after ? o.after.overallScore - o.before.overallScore : null;

export function CockpitRunPanel({ detail, live, onStop, onRetry, busy = false, error = null }: CockpitRunPanelProps) {
  if (!detail) {
    return (
      <div>
        <Kicker tone="accent">Run</Kicker>
        <InlineEmpty>Starting the run…</InlineEmpty>
      </div>
    );
  }
  const { run, lanes, outcomes } = detail;
  const byLane = new Map(outcomes.map((o) => [o.lane.id, o]));
  const done = lanes.filter((l) => l.phase === "done").length;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Run · {run.phase}</Kicker>
        <span className="font-mono text-xs tabular-nums text-slate-500">
          cycle {run.cycle}/{run.maxCycles} · {done}/{lanes.length} lanes done
        </span>
      </div>

      {run.error && <p className="mt-2 font-mono text-xs text-danger">{run.error}</p>}
      {error && <p className="mt-2 font-mono text-xs text-danger">{error}</p>}

      {lanes.length === 0 ? (
        <InlineEmpty>No lanes on the board yet.</InlineEmpty>
      ) : (
        <ul className={`mt-3 ${TILE_LEDGER}`}>
          {lanes.map((lane) => (
            <LaneRail key={lane.id} lane={lane} lift={liftOf(byLane.get(lane.id))} onRetry={onRetry} busy={busy} />
          ))}
        </ul>
      )}

      {live && (
        <button
          type="button"
          onClick={onStop}
          disabled={busy}
          className="focus-ring mt-4 w-full rounded-md border border-danger/60 px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-danger transition hover:bg-danger/10 disabled:opacity-50"
        >
          Stop after in-flight
        </button>
      )}
    </div>
  );
}
