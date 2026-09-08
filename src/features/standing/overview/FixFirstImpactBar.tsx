// One candidate's projected fleet gain, drawn on the band's shared scale.
//
// Server-safe: no hooks, so it stays inside the Overview's server-rendered "Fix first" panel. No
// entrance transition of its own either — the band is a direct child of OverviewTab's
// `stagger-children` wrapper, which already cascades it in, and a second entrance would double up
// (the same rule that file's header states about `.animate-arrive-in`).
//
// The encoding is MatrixGrid's, deliberately: the track frame is ALWAYS drawn, so a void is a
// locatable empty track rather than a hole; the bar is drawn only when the state is not a void; the
// number prints only where `rendersValue` allows it. That is why a candidate with no scoring model
// (a findings queue) cannot appear here as a 0-length bar labelled "0" — the guard is structural.

import { linScale } from "@/components/report/chartScale";
import { fmtNum, isNum, r2 } from "@/components/org/viz";
import { STATE_LABEL, StateSwatch, isVoid, rendersValue, stateFill, stateStroke } from "@/components/org/viz";
import type { FixFirstImpact } from "./fixFirstImpact";

const W = 160;
const H = 10;
/** A measured gain never renders thinner than this, so a real but tiny gain is still a mark. */
const MIN_BAR = 3;

export function FixFirstImpactBar({
  impact,
  max,
  subject,
}: {
  impact: FixFirstImpact;
  /** The band's shared upper bound (`impactScaleMax`). `null` → nothing in the band was computable. */
  max: number | null;
  /** Noun phrase naming what the bar is about, for the accessible label. */
  subject: string;
}) {
  const drawable = !isVoid(impact.state) && isNum(impact.gain) && isNum(max) && max > 0;
  const x = linScale(isNum(max) && max > 0 ? max : 1, 0, W);
  const len = drawable ? Math.max(MIN_BAR, r2(x(impact.gain as number))) : 0;
  const label = `${subject} — ${STATE_LABEL[impact.state]}. ${impact.basis}`;

  return (
    <div className="flex items-center gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-2.5 w-full max-w-[10rem]" role="img" aria-label={label}>
        <title>{label}</title>
        {/* the track — always drawn, so an unmeasurable candidate has a visible, pointable absence */}
        <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={2} fill="none" stroke="var(--color-divider)" strokeWidth={1} strokeOpacity={0.6} />
        {drawable && (
          <rect
            data-bar
            x={0.5}
            y={0.5}
            width={len}
            height={H - 1}
            rx={2}
            fill={stateFill(impact.state)}
            fillOpacity={0.55}
            stroke={stateStroke(impact.state)}
            strokeWidth={1}
          />
        )}
      </svg>
      {/* The readout. A state that renders no value gets the kit's void MARK, never an em dash: a
          dash is what a reader mistakes for a zero, which is the whole reason the vocabulary exists. */}
      <span className="flex w-14 shrink-0 justify-end type-mono-sm tabular-nums text-slate-400">
        {rendersValue(impact.state) && isNum(impact.gain) ? `+${fmtNum(impact.gain, 1)}` : <StateSwatch state={impact.state} size={12} />}
      </span>
    </div>
  );
}
