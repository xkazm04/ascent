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
  // MOONSHOT #3 — a run whose lanes are worked elsewhere. The stop button is hidden for it, and that
  // is the honest thing rather than a missing feature: "stop after in-flight" is a cooperative signal
  // to a process THIS deployment is driving, and there is no such process here. What a remote run's
  // owner can actually do is let the leases lapse, which the rows say for themselves.
  const remote = lanes.length > 0 && lanes.every((l) => l.executor === "remote-agent");
  const unclaimed = lanes.filter((l) => l.executor === "remote-agent" && !l.claimedBy).length;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Run · {run.phase}</Kicker>
        <span className="type-caption tabular-nums text-slate-500">
          cycle {run.cycle}/{run.maxCycles} · {done}/{lanes.length} lanes done
        </span>
      </div>

      {remote && (
        <p className="mt-2 type-caption text-slate-500" data-testid="remote-run-note">
          {unclaimed > 0
            ? `Waiting on an agent. ${unclaimed} of ${lanes.length} lane${lanes.length === 1 ? "" : "s"} not yet claimed — point your agent at this organization's MCP door with a followups:write token.`
            : "Every lane is claimed. Ascent runs none of this work; it adjudicates each repository's next scan of the default branch."}
        </p>
      )}

      {run.error && <p className="mt-2 type-caption text-danger">{run.error}</p>}
      {error && <p className="mt-2 type-caption text-danger">{error}</p>}

      {lanes.length === 0 ? (
        <InlineEmpty>No lanes on the board yet.</InlineEmpty>
      ) : (
        <ul className={`mt-3 ${TILE_LEDGER}`}>
          {lanes.map((lane) => (
            <LaneRail key={lane.id} lane={lane} lift={liftOf(byLane.get(lane.id))} onRetry={onRetry} busy={busy} />
          ))}
        </ul>
      )}

      {live && !remote && (
        <button
          type="button"
          onClick={onStop}
          disabled={busy}
          className="focus-ring mt-4 w-full rounded-md border border-danger/60 px-3 py-2 type-label tracking-[0.18em] text-danger transition hover:bg-danger/10 disabled:opacity-50"
        >
          Stop after in-flight
        </button>
      )}
    </div>
  );
}
