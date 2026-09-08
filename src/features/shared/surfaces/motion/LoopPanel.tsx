"use client";

// unprompted-motion-lifecycle: an auto-advancing strip nobody asked for. It runs past five seconds,
// so it owes a VISIBLE, operable stop; the stop is one-directional (a separate labelled "resume"
// restarts, and restarts the interval from the beginning); the first deliberate interaction —
// picking a step — is itself a stop; its cadence derives from elapsed time, not counted ticks.
// loop-pause-governance: the closed decider ledger the loop reads as one merged answer — reduced,
// in-view, foregrounded, user stop, and a TIMED hover pause that expires on its own so a touch tap
// can never wedge the loop. Remaining time is banked across machine pauses.

import { useRef, useState } from "react";
import { useElapsedStep, usePauseAuthorities, type Decider } from "./motionHooks";
import { BUDGET, animationFor } from "./presets";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";

const STEPS = ["scan", "score", "plan", "ship"] as const;
const INTERVAL_MS = 1500;
const ALL: Decider[] = ["reduced", "in-view", "foregrounded", "user-stop", "hover (timed)"];
const HAS_OBSERVER = typeof IntersectionObserver !== "undefined";

export function LoopRegions({ reduced }: { reduced: boolean }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const pause = usePauseAuthorities(reduced, stripRef);
  const auto = useElapsedStep(STEPS.length, INTERVAL_MS, pause.paused);
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked ?? auto.step;

  const pick = (i: number) => {
    setPicked(i);
    pause.stop(); // taking control is itself a stop
  };
  const resume = () => {
    setPicked(null);
    auto.restart(); // a user resume begins the interval, it does not continue a remainder
    pause.resume();
  };

  return (
    <>
      <Region technique="unprompted-motion-lifecycle" title="Motion nobody asked for" note="Starts on its own; stops on the first deliberate act or the stop control; resumes only through the labelled control.">
        <div ref={stripRef} className="flex items-center gap-2" data-loop-paused={pause.paused} onPointerEnter={pause.armHover}>
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              className={i === shown ? BTN_ON : BTN}
              aria-current={i === shown ? "step" : undefined}
              onClick={() => pick(i)}
              style={{ animation: i === shown && !pause.paused ? animationFor("ambient-breathe", reduced, { loop: true }) : "none" }}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} onClick={pause.stop} disabled={pause.userStop} aria-label="Stop the loop">
            ■ stop
          </button>
          <button type="button" className={BTN} onClick={resume} disabled={!pause.userStop} aria-label="Resume the loop">
            ▶ resume
          </button>
          <span className="type-caption text-slate-500">
            {auto.owesControl ? `past ${BUDGET.visibleControlAfterMs / 1000}s: a visible stop is required` : `${Math.round(auto.elapsedMs / 1000)}s run`}
          </span>
        </div>
        <p className="mt-2 type-caption text-slate-500">Step derives from elapsed time minus banked pauses — two mounts compute the same step rather than advancing twice.</p>
      </Region>

      <Region technique="loop-pause-governance" title="One merged pause signal" note="A closed set of deciders; each is a veto; the loop asks one question: am I allowed to run?">
        <ul className="space-y-1">
          {ALL.map((d) => {
            const veto = pause.vetoes.includes(d);
            const abstains = d === "in-view" && !HAS_OBSERVER;
            return (
              <li key={d} className="flex items-center justify-between type-caption" data-decider={d} data-veto={veto}>
                <span className="text-slate-300">{d}</span>
                <span className={veto ? "text-warn" : "text-slate-500"}>{abstains ? "abstains (no observer)" : veto ? "veto" : "no objection"}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 space-y-1">
          <Readout label="merged" value={<span data-merged={pause.paused ? "paused" : "running"}>{pause.paused ? "paused" : "running"}</span>} tone={pause.paused ? "text-warn" : "text-success-soft"} />
          <Readout label="hover pause" value={pause.hoverPaused ? `lifts in ${(pause.hoverRemainingMs / 1000).toFixed(1)}s` : "not armed"} />
        </div>
        <p className="mt-2 type-caption text-slate-500">Hover over the strip: the pause is timed, so a tap that never leaves still lifts. Only observable-state pauses may be open-ended.</p>
      </Region>
    </>
  );
}
