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
import { laneExecutorTag, leaseCountdown, verifyVerdictTag, type LoopLaneRecord } from "./loopTypes";

export interface LaneRailProps {
  lane: LoopLaneRecord;
  /** Overall movement this lane produced, once both ends are known. */
  lift?: number | null;
  onRetry?: (laneId: string) => void;
  busy?: boolean;
}

/** Micro-cents → a figure a reader can price work with. `null` is stated, never rendered as zero. */
const fmtLaneCost = (micros: number | null): string => {
  if (micros == null) return "cost unknown";
  const cents = micros / 1_000_000;
  return cents < 100 ? `${cents.toFixed(2)}¢` : `$${(cents / 100).toFixed(2)}`;
};

export function LaneRail({ lane, lift = null, onRetry, busy = false }: LaneRailProps) {
  const [open, setOpen] = useState(false);
  const at = laneStopIndex(lane);
  const pct = laneMarkerPct(lane);
  const live = laneIsLive(lane.phase);
  const failed = lane.phase === "error";
  const tail = lane.log.slice(-6);
  const executor = laneExecutorTag(lane.executor);
  const countdown = leaseCountdown(lane.leaseUntil);
  // THE DEGRADATION GUARD'S VERDICT — one word beside the counters, never a panel of its own. `null`
  // for a lane written before the guard existed: unknown is not `skipped`, and a tag on it would be a
  // claim about a run nobody made. Only `rejected` is coloured, because only `rejected` means the
  // cycle was reversed; `unverified` is a fact, not a fault, and colouring it would read as one.
  const verified = verifyVerdictTag(lane.verifyVerdict);

  return (
    <li className="bg-ink px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 truncate type-mono-sm text-slate-200" title={lane.repoFullName}>
          {lane.repoFullName}
        </span>
        <span className="shrink-0 type-caption tabular-nums text-slate-500">
          cycle {lane.cycle} · {lane.commits} commits ·{" "}
          {/* ONE WORD, ONE FACT (MC-B41). "closed by the rescan" is reserved for a PER-ITEM verdict
              (`CockpitVerdicts`); this is a lane-level COUNT of the rescan's adjudicated set
              (`decideInProgress`), so it says "verified closed". A reader who has just been taught
              that "claimed resolved" is not "closed" must not then meet "closed" meaning a third
              thing on the same screen. The ceiling is in the title: a lane written before the
              adjudicated set landed carries the raw trailer count and was never backfilled. */}
          <span title="Follow-ups this lane's rescan VERIFIED closed: the gap is no longer raised and its dimension measurably moved. An agent's unconfirmed claim is not counted. On a lane run before 2026-08-31 this is the commit-trailer count, which was never backfilled.">
            {lane.closedIds.length} verified closed
          </span>
          {lift != null && lift !== 0 && <span className="ml-2 text-slate-300">{fmtDelta(lift)}</span>}
        </span>
      </div>

      {/* WHAT THIS LANE'S SESSION COST. In the counters' own muted type and with no colour of its
          own: a cost is not a verdict, and a red or green number here would read as one. A lane that
          reported nothing says `cost unknown` rather than $0.00 — the CLI not telling us is not the
          same fact as a free session. */}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        {/* WHO IS DOING THIS LANE (moonshot #3). The chip appears only on a remote lane — a badge on
            every row of a self-hosted board would say nothing. The claimant and the lease countdown
            sit beside it in the same muted counter type: who holds the work and for how long is a
            FACT, not a verdict, and colouring it would read as one. */}
        {executor && (
          <span data-testid="lane-executor" className="font-mono text-xs tabular-nums text-slate-500">
            {[executor, lane.claimedBy, countdown].filter(Boolean).join(" · ")}
          </span>
        )}
        {verified && (
          <span
            data-testid="lane-verify"
            className={`font-mono text-xs tabular-nums ${lane.verifyVerdict === "rejected" ? "text-danger" : "text-slate-500"}`}
            title={lane.verifyNote ?? undefined}
          >
            {verified}
          </span>
        )}
        {(executor || lane.model || lane.costMicros != null || lane.turns != null) && (
          <span
            data-testid="lane-cost"
            className="font-mono text-xs tabular-nums text-slate-500"
            title={
              executor
                ? "This lane's work happens in an agent Ascent did not spawn, so there is no session envelope to read a cost from. Unknown — not free."
                : lane.costSource
                  ? `Cost as the agent's own session envelope reported it (source: ${lane.costSource}). Never summed with any other measurement of the same session.`
                  : undefined
            }
          >
            {[lane.model, lane.turns != null ? `${lane.turns} turns` : null, fmtLaneCost(lane.costMicros)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
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
        <span className={`type-caption ${failed ? "text-danger" : "text-slate-500"}`}>
          {failed ? lane.error || "error" : laneCaption(lane)}
        </span>
        <span className="flex items-center gap-3 type-caption">
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
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-divider bg-surface-strong/60 p-2 font-mono type-micro leading-relaxed text-slate-400">
          {tail.join("\n")}
        </pre>
      )}
    </li>
  );
}
