// probe-deferral-to-idle: the first sample waits for idle OR a timeout, whichever first, and the
// winner cancels the loser (two creations, two reapers). Until the first window closes the state is
// UNMEASURED — a state, not a tier — and what renders is the DECLARED default, so the first
// transition on a fast device is richness arriving, never something the user saw being taken away.

import { DEFAULT_TIER, IDLE_TIMEOUT_MS, type ProbeState } from "./probe";
import { BTN, Readout, Region, TierChip } from "./parts";

export function DeferralRegion({ state, onFire, onReset }: { state: ProbeState; onFire: (winner: "idle" | "timeout") => void; onReset: () => void }) {
  const waiting = state.phase === "unmeasured";
  const won = state.deferral.wonBy;
  const handle = (name: "idle" | "timeout") => {
    if (state.phase === "short-circuited") return "never created";
    if (waiting) return "armed";
    if (won === name) return "fired";
    if (won) return "cancelled by the winner";
    return "cleared";
  };
  return (
    <Region technique="probe-deferral-to-idle" title="Sample after the load, not during it" note={`The first frames are the load. Idle, or ${IDLE_TIMEOUT_MS} ms, whichever first — an idle request alone never fires on the slow device this exists for.`}>
      <div className="space-y-1">
        <Readout label="requestIdleCallback" value={<span data-handle-idle={handle("idle")}>{handle("idle")}</span>} tone={handle("idle") === "armed" ? "text-warn" : "text-slate-300"} />
        <Readout label={`setTimeout(${IDLE_TIMEOUT_MS})`} value={<span data-handle-timeout={handle("timeout")}>{handle("timeout")}</span>} tone={handle("timeout") === "armed" ? "text-warn" : "text-slate-300"} />
        <Readout
          label="state"
          value={<span data-measure-state={state.phase === "short-circuited" ? "no-probe" : state.tierSource === "measured" ? "measured" : "unmeasured"}>{state.phase === "short-circuited" ? "no probe" : state.tierSource === "measured" ? "measured" : "unmeasured — not the same as fast"}</span>}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={() => onFire("idle")} disabled={!waiting} aria-label="Idle arrives">
          idle arrives
        </button>
        <button type="button" className={BTN} onClick={() => onFire("timeout")} disabled={!waiting} aria-label="Timeout fires">
          timeout fires
        </button>
        <button type="button" className={BTN} onClick={onReset} aria-label="Reload the page (reset the probe)">
          reload
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-divider p-2">
        <span className="type-caption text-slate-500">declared default</span>
        <TierChip tier={DEFAULT_TIER} />
        <span className="type-caption text-slate-500">load-visible effects mount here and step up when the first window lands: an arrival, not a removal.</span>
      </div>
    </Region>
  );
}
