// THE STAGE TRACK — plan → baseline → agent → check → commit → land, with the current stop lit. The
// rail's fill slides to a new stop only when the lane's phase changes (a real event); nothing on the
// track moves otherwise. Landed lights the whole track green; a quiet lane's stop goes grey (present,
// not progressing); a failed lane is drawn unlit — the pulse does not say at which stop it failed.

import { STAGES } from "./missionModel";
import type { LaneTone } from "./missionModel";
import { fs, STAGE_S, TYPE } from "./missionTokens";

const LIT: Record<LaneTone, { dot: string; rail: string; text: string }> = {
  working: { dot: "bg-accent border-accent", rail: "bg-accent/70", text: "text-white" },
  quiet: { dot: "bg-slate-500 border-slate-500", rail: "bg-slate-600", text: "text-slate-300" },
  landed: { dot: "bg-success border-success", rail: "bg-success/80", text: "text-success-soft" },
  held: { dot: "bg-amber-400 border-amber-400", rail: "bg-amber-400/60", text: "text-amber-300" },
  failed: { dot: "bg-danger border-danger", rail: "bg-danger/60", text: "text-danger" },
  done: { dot: "bg-slate-400 border-slate-400", rail: "bg-slate-500", text: "text-slate-300" },
};

export function StageTrack({ stage, tone, scale, reducedMotion }: { stage: number; tone: LaneTone; scale: number; reducedMotion: boolean }) {
  const lit = LIT[tone];
  const last = STAGES.length - 1;
  // The rail fills from the first stop to the current one (or all the way when every stop passed).
  const fillTo = stage < 0 ? 0 : Math.min(stage, last) / last;
  const current = stage >= 0 && stage <= last ? STAGES[stage] : null;
  // Six equal columns: a stop sits at the centre of each, so the rail runs from 1/12 to 11/12.
  const edge = 100 / (2 * STAGES.length);
  return (
    <div role="group" className="flex w-full flex-col gap-[0.6em]" style={fs(TYPE.label, scale)} aria-label={current ? `Stage: ${current}` : stage > last ? "Every stage passed" : "Not started"}>
      <div className="relative grid h-[1.4em] grid-cols-6 items-center">
        <div className="absolute top-1/2 h-px -translate-y-1/2 bg-slate-700" style={{ left: `${edge}%`, right: `${edge}%` }} />
        <div
          data-stage-rail
          className={`absolute top-1/2 h-[0.22em] -translate-y-1/2 rounded-full ${lit.rail}`}
          style={{
            left: `${edge}%`,
            width: `${fillTo * (100 - 2 * edge)}%`,
            transition: reducedMotion ? undefined : `width ${STAGE_S}s cubic-bezier(0.16,1,0.3,1), background-color ${STAGE_S}s`,
          }}
        />
        {STAGES.map((s, i) => {
          const passed = i < stage;
          const isNow = i === stage;
          return (
            <span key={s} className="relative flex justify-center">
              <span
                data-stop={s}
                data-now={isNow || undefined}
                className={`block rounded-full border-2 ${
                  isNow ? `h-[1.3em] w-[1.3em] ${lit.dot}` : passed ? `h-[0.8em] w-[0.8em] ${lit.dot} opacity-70` : "h-[0.8em] w-[0.8em] border-slate-600 bg-ink"
                }`}
                style={{ transition: reducedMotion ? undefined : `all ${STAGE_S}s ease-out` }}
              />
            </span>
          );
        })}
      </div>
      <div className="grid grid-cols-6 text-center font-mono uppercase">
        {STAGES.map((s, i) => (
          <span key={s} className={i === stage ? `font-semibold ${lit.text}` : i < stage ? "text-slate-400" : "text-slate-600"}>
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
