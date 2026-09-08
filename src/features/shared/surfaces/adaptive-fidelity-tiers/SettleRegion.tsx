// measurement-settle-budget: the probe names its reaper at creation — it stops when the tier holds for
// STABLE_WINDOWS windows (the ordinary exit) or, unconditionally, at a wall-clock deadline measured
// from the first sample, resolving an unsettled device DOWN. The stop is a teardown (the play interval
// is cleared, no per-frame wake-up survives), and the way back is event-shaped re-arming — a return
// from a long absence, a heavier view — each a fresh bounded budget, and capped in count.

import { REARM_CAP, SETTLE_MS, STABLE_WINDOWS, type ProbeState, type Rearm } from "./probe";
import { BTN, Readout, Region } from "./parts";

const REARMS: readonly { reason: Rearm; label: string }[] = [
  { reason: "foreground", label: "return to foreground after a long absence" },
  { reason: "heavier-view", label: "enter a heavier view" },
];

export function SettleRegion({ state, playing, onRearm }: { state: ProbeState; playing: boolean; onRearm: (reason: Rearm) => void }) {
  const pct = Math.min(100, Math.round((state.elapsedMs / SETTLE_MS) * 100));
  const settled = state.phase === "settled";
  const status =
    state.phase === "short-circuited" ? "no probe" : state.phase === "unmeasured" ? "not started" : settled ? (state.settledBy === "stability" ? "settled · stable" : "settled · deadline → resolved down") : "sampling";
  return (
    <Region technique="measurement-settle-budget" title="The probe has a deadline" note={`Stops on ${STABLE_WINDOWS} unchanged windows, or at ${SETTLE_MS / 1000}s from the first sample whether or not it settled — then it is gone for the session.`}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-divider" role="meter" aria-valuenow={Math.round(state.elapsedMs)} aria-valuemax={SETTLE_MS} aria-label="Settle budget">
        <div className={`h-full ${settled ? "bg-slate-500" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 space-y-1">
        <Readout label="status" value={<span data-settle={status}>{status}</span>} tone={settled ? "text-slate-400" : "text-slate-200"} />
        <Readout label="since first sample" value={`${(state.elapsedMs / 1000).toFixed(1)}s / ${SETTLE_MS / 1000}s`} />
        <Readout label="stable run" value={<span data-stable-run={state.stableRun}>{`${state.stableRun} / ${STABLE_WINDOWS}`}</span>} />
        <Readout label="per-frame wake-up" value={<span data-wakeup={playing ? "armed" : "none"}>{playing ? "interval armed" : "none — cleared"}</span>} tone={playing ? "text-warn" : "text-slate-400"} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {REARMS.map((r) => (
          <button key={r.reason} type="button" className={BTN} onClick={() => onRearm(r.reason)} disabled={!settled || state.rearms >= REARM_CAP} aria-label={`Re-arm: ${r.label}`}>
            {r.label}
          </button>
        ))}
      </div>
      <p className="mt-2 type-caption text-slate-500" data-rearms={state.rearms}>
        re-arms {state.rearms} / {REARM_CAP} — an event costs nothing until it happens; a poll costs something always. Past the cap the device has said what it is.
      </p>
    </Region>
  );
}
