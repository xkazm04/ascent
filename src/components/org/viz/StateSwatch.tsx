// The canonical mark for one `VizState`, at legend scale. Server-safe.
//
// A legend that describes an encoding in words has re-introduced the prose it was meant to replace,
// so every row of `Legend` shows the REAL symbol — painted by `stateFill`/`stateStroke`, over the
// same `<VizDefs/>` hatch the charts use. `missing` is the one state with no shape in a chart (it is
// a void), so its swatch is a broken rule: the gap itself, drawn small enough to point at.

import {
  HATCH_ID,
  VizDefs,
  isStruck,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
  type VizState,
} from "@/components/org/viz/states";

const S = 14; // swatch box edge, in user units and CSS px

export function StateSwatch({
  state,
  baseColor,
  size = S,
  className = "",
}: {
  state: VizState;
  /** Score-derived paint (`scoreHex(...)`) where the caller has one; defaults to the brand accent. */
  baseColor?: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${S} ${S}`}
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={stateTitle(state)}
    >
      {state === "not-judged" && <VizDefs />}
      {state === "missing" ? (
        // The void, made pointable: two stubs with the gap between them. Nothing is drawn where a
        // measurement would be, which is the whole encoding.
        <g stroke="var(--color-divider)" strokeWidth={2} strokeLinecap="round">
          <line x1={1} y1={S / 2} x2={4} y2={S / 2} />
          <line x1={S - 4} y1={S / 2} x2={S - 1} y2={S / 2} />
        </g>
      ) : (
        <rect
          data-swatch
          x={1.5}
          y={1.5}
          width={S - 3}
          height={S - 3}
          rx={2}
          fill={state === "not-judged" ? `url(#${HATCH_ID})` : stateFill(state, baseColor)}
          fillOpacity={stateFillOpacity(state)}
          stroke={stateStroke(state, baseColor)}
          strokeWidth={stateStrokeWidth(state)}
          strokeDasharray={stateDash(state)}
        />
      )}
      {isStruck(state) && (
        <line
          x1={0}
          y1={S / 2}
          x2={S}
          y2={S / 2}
          stroke="var(--color-divider)"
          strokeWidth={1.5}
          data-strike
        />
      )}
    </svg>
  );
}
