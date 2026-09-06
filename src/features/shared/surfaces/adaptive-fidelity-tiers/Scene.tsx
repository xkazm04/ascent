"use client";

// The adaptive-fidelity showcase: an ambient strata header with its fidelity instrument underneath —
// one probe (useProbe → probe.ts) measures a seeded frame trace window by window and publishes one
// tier that the header's effects read at render; the six regions each carry
// `data-technique="<slug>"` and are spotlit by the frame. `reduced` and `volume` come from props —
// never a media query here. `volume` is accepted and ignored (feedback-and-style, not data-display):
// a frame trace has no row count. The play loop is user-started, pausable here, and starts paused
// under `reduced` (where the probe is not created at all).

import type { SurfaceSceneProps } from "../surfaceBody";
import { BudgetRegion } from "./BudgetRegion";
import { DeferralRegion } from "./DeferralRegion";
import { LadderRegion } from "./LadderRegion";
import { TRACE } from "./fixtures";
import { BTN, BTN_ON, TierChip } from "./parts";
import { PreferenceRegion } from "./PreferenceRegion";
import { WINDOW_SAMPLES } from "./probe";
import { SettleRegion } from "./SettleRegion";
import { StatisticRegion } from "./StatisticRegion";
import { useProbe } from "./useProbe";

export function Scene({ reduced }: SurfaceSceneProps) {
  const probe = useProbe(reduced);
  const { state, dispatch } = probe;
  const canPlay = state.phase === "unmeasured" || state.phase === "sampling";
  return (
    <div className="space-y-3" data-scene="adaptive-fidelity-tiers" data-reduced={reduced} data-tier={state.tier} data-phase={state.phase}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-divider bg-ink px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="type-caption text-slate-500">tier</span>
          <TierChip tier={state.tier} />
          <span className="type-caption text-slate-500" data-phase-label>
            {state.phase === "short-circuited" ? "preference · no probe" : state.phase === "unmeasured" ? "unmeasured · declared default" : state.phase === "sampling" ? `sampling · window ${state.closed + 1}` : "settled"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={probe.playing ? BTN_ON : BTN} onClick={probe.playing ? probe.pause : probe.play} disabled={!canPlay} aria-label={probe.playing ? "Pause the scripted session" : "Play the scripted session"}>
            {probe.playing ? "■ pause" : "▶ play session"}
          </button>
          <button type="button" className={BTN} onClick={probe.reset} aria-label="Reset the probe">
            reset
          </button>
        </div>
      </div>
      <p className="type-caption text-slate-500">
        Fixture data: a seeded frame trace of <span className="text-slate-300">{TRACE.length}</span> scripted windows × {WINDOW_SAMPLES} intervals, and one fictional device. The samples are fiction; the arithmetic is the technique. Nothing here is an Ascent org.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <StatisticRegion state={state} onStraddled={() => dispatch({ type: "window", kind: "good", straddled: true })} />
        <LadderRegion state={state} onWindow={(kind) => dispatch({ type: "window", kind })} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <SettleRegion state={state} playing={probe.playing} onRearm={(reason) => dispatch({ type: "rearm", reason })} />
        <DeferralRegion state={state} onFire={(winner) => dispatch({ type: "fire", winner })} onReset={probe.reset} />
      </div>
      <BudgetRegion tier={state.tier} reduced={reduced} />
      <PreferenceRegion state={state} reduced={reduced} preference={probe.preference} onPreference={probe.setPreference} />
    </div>
  );
}
