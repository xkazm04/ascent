"use client";

// ONE LANE, as a rail. The marker's position is a CSS `left:%` transition rather than a re-render
// animation, so a lane that advances two stops in one poll tick glides instead of teleporting — and
// `motion-reduce:transition-none` makes that a hard cut for anyone who asked for one.
//
// The stops are the lane's real observable states (laneStages.ts owns that rule and its test); the
// commit/closed figures are counters beside the rail, deliberately not stops of their own.

import { useState } from "react";
import { fmtDelta } from "@/components/ui";
import { LANE_STOPS, laneCaption, laneIsLive, laneMarkerPct, laneStopIndex } from "./laneStages";
import type { LoopLaneRecord } from "./loopTypes";

export interface LaneRailProps {
  lane: LoopLaneRecord;
  /** Overall movement this lane produced, once both ends are known. */
  lift?: number | null;
  onRetry?: (laneId: string) => void;
  busy?: boolean;
}

export function LaneRail({ lane, lift = null, onRetry, busy = false }: LaneRailProps) {
  const [open, setOpen] = useState(false);
  const at = laneStopIndex(lane);
  const pct = laneMarkerPct(lane);
  const live = laneIsLive(lane.phase);
  const failed = lane.phase === "error";
  const tail = lane.log.slice(-6);

  return (
    <li className="bg-ink px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 truncate font-mono text-sm text-slate-200" title={lane.repoFullName}>
          {lane.repoFullName}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">
          cycle {lane.cycle} · {lane.commits} commits · {lane.closedIds.length} closed
          {lift != null && lift !== 0 && <span className="ml-2 text-slate-300">{fmtDelta(lift)}</span>}
        </span>
      </div>

      <div className="relative mt-2 h-6" aria-hidden>
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-divider" />
        <div
          className="absolute top-1/2 h-px -translate-y-1/2 bg-accent/50 transition-[width] duration-500 motion-reduce:transition-none"
          style={{ left: 0, width: `${pct}%` }}
        />
        {LANE_STOPS.map((stop, i) => (
          <span
            key={stop.id}
            title={stop.label}
            className={`absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              i <= at ? "bg-accent/70" : "bg-divider"
            }`}
            style={{ left: `${(i / (LANE_STOPS.length - 1)) * 100}%` }}
          />
        ))}
        <span
          data-testid="lane-marker"
          data-stop={LANE_STOPS[at]!.id}
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-[left] duration-500 motion-reduce:transition-none ${
            failed ? "border-danger bg-danger/30" : "border-accent bg-accent/40"
          } ${live ? "live-dot" : ""}`}
          style={{ left: `${pct}%` }}
        />
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <span className={`font-mono text-xs ${failed ? "text-danger" : "text-slate-500"}`}>
          {failed ? lane.error || "error" : laneCaption(lane)}
        </span>
        <span className="flex items-center gap-3 font-mono text-xs">
          {lane.branch && <span className="text-slate-600">{lane.branch}</span>}
          {failed && onRetry && (
            <button
              type="button"
              onClick={() => onRetry(lane.id)}
              disabled={busy}
              className="focus-ring rounded text-accent hover:text-accent-soft disabled:opacity-50"
            >
              Retry
            </button>
          )}
          {tail.length > 0 && (
            <button type="button" onClick={() => setOpen(!open)} className="focus-ring rounded text-slate-500 hover:text-slate-300">
              {open ? "hide log" : "log"}
            </button>
          )}
        </span>
      </div>

      {open && tail.length > 0 && (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-divider bg-surface-strong/60 p-2 font-mono text-[11px] leading-relaxed text-slate-400">
          {tail.join("\n")}
        </pre>
      )}
    </li>
  );
}
