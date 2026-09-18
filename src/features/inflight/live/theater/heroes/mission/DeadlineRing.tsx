// THE DEADLINE RING — time used of the lane's watchdog ceiling. It is a CLOCK, not a progress meter:
// it fills because time passes, whether or not the agent gets anywhere, and it says so ("time used").
// It fills in real time off `now` (a 1 s linear transition bridges the page clock's ticks); `now` is
// frozen on a stale pulse, so the ring stops exactly when the truth stops arriving. Amber past three
// quarters of the ceiling, red at it. Reduced motion: no transition, the true value every tick.

import { fmtClockSpan } from "./missionModel";
import { fluid, fs, RING_SIZE, TYPE } from "./missionTokens";

const R = 44;
const C = 2 * Math.PI * R;

/** Accent while there is room; the theater's attention amber past three quarters; red at the ceiling.
 *  A landed session's ring is green: the time it took, held at the landing. */
function ringStroke(frac: number, landed: boolean): string {
  if (landed) return "stroke-success";
  if (frac >= 1) return "stroke-danger";
  if (frac >= 0.75) return "stroke-amber-400";
  return "stroke-accent";
}

export function DeadlineRing({
  repo,
  ring,
  scale,
  dim,
  landed,
  reducedMotion,
}: {
  repo: string;
  ring: { frac: number; elapsedMs: number; budgetMs: number };
  scale: number;
  dim: boolean;
  landed: boolean;
  reducedMotion: boolean;
}) {
  const size = fluid(RING_SIZE, scale);
  const pct = Math.round(ring.frac * 100);
  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <div
        role="meter"
        aria-label={`${repo}: time used of the lane's deadline`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${fmtClockSpan(ring.elapsedMs)} of ${fmtClockSpan(ring.budgetMs)}`}
        className="relative"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={R} fill="none" className="stroke-divider" strokeWidth="5" />
          <circle
            data-ring-fill
            cx="50"
            cy="50"
            r={R}
            fill="none"
            className={ringStroke(ring.frac, landed)}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - ring.frac)}
            opacity={dim ? 0.45 : 1}
            style={reducedMotion ? undefined : { transition: "stroke-dashoffset 1s linear, stroke 0.6s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className={`font-mono font-semibold tabular-nums ${dim ? "text-slate-400" : "text-white"}`} style={fs(TYPE.ringClock, scale)}>
            {fmtClockSpan(ring.elapsedMs)}
          </span>
          <span className="mt-[0.3em] font-mono tabular-nums text-slate-400" style={fs(TYPE.ringSub, scale)}>
            of {fmtClockSpan(ring.budgetMs)}
          </span>
        </div>
      </div>
      <span className="font-mono uppercase tracking-[0.2em] text-slate-500" style={fs(TYPE.label, scale)}>
        {landed ? "time taken" : "time used"}
      </span>
    </div>
  );
}
