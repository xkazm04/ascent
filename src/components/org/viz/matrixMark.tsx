// The state mark for an HTML-laid-out matrix cell. Server-safe.
//
// MatrixGrid lays the grid out in CSS so type can be set in the
// semantic `type-*` scale instead of viewBox units — but the epistemic encoding must stay the SVG
// one from `states.ts`: the ONE hatch, the one dash array, the accent ring. So each cell is an HTML
// box with this SVG overlay inside it, painted by `stateFill`/`stateStroke` exactly as the baseline
// paints its rects. Percent-sized, so it follows the box; the box, not the SVG, owns the geometry.

import { heatCell } from "@/lib/ui";
import { isNum } from "@/components/org/viz/vizNum";
import {
  VizDefs,
  isVoid,
  rendersValue,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateStroke,
  stateStrokeWidth,
  type VizState,
} from "@/components/org/viz/states";
import type { MatrixCell } from "@/components/org/viz/matrixShared";

/** Render once per grid so `url(#hatch)` resolves; every copy is byte-identical (states.ts). */
export function MatrixHatchDefs() {
  return (
    <svg aria-hidden className="absolute h-0 w-0" focusable="false">
      <VizDefs />
    </svg>
  );
}

/**
 * The overlay: an always-drawn frame (a void is a locatable EMPTY cell, not a hole) and, for every
 * state but `missing`, the mark itself. `alpha` scales the fill so a solid measurement reads as a
 * tint the ink stays legible on — pass the same alpha to `cellInk` so the two agree.
 */
export function MatrixMark({
  state,
  base,
  alpha,
  radius = 3,
  inset = "inset-[3px]",
}: {
  state: VizState;
  /** Score-derived paint (`scoreHex`) where the cell has one; the accent otherwise. */
  base?: string;
  alpha: number;
  radius?: number;
  inset?: string;
}) {
  return (
    <div aria-hidden className={`pointer-events-none absolute ${inset}`}>
      <svg className="h-full w-full overflow-visible" focusable="false">
        <rect x={0} y={0} width="100%" height="100%" rx={radius} fill="none" stroke="var(--color-divider)" strokeWidth={1} strokeOpacity={0.5} />
        {!isVoid(state) && (
          <rect
            data-mark
            x={0}
            y={0}
            width="100%"
            height="100%"
            rx={radius}
            fill={stateFill(state, base)}
            fillOpacity={stateFillOpacity(state) * alpha}
            stroke={stateStroke(state, base)}
            strokeWidth={stateStrokeWidth(state)}
            strokeDasharray={stateDash(state)}
          />
        )}
      </svg>
    </div>
  );
}

/**
 * Ink for a printed value: computed contrast against the tinted fill (`heatCell`) where the cell is
 * filled; `undefined` where it is outline-only or prints nothing, so the caller's `text-slate-*`
 * class stands. Only meaningful when `rendersValue`.
 */
export function cellInk(cell: MatrixCell, alpha: number): string | undefined {
  if (!rendersValue(cell.state) || !isNum(cell.score) || cell.state === "declared") return undefined;
  return heatCell(cell.score, stateFillOpacity(cell.state) * alpha).text;
}
