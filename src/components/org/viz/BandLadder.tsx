"use client";

// Nested bands — the perimeter drawn instead of described.
//
// Governance stance and passport clearance are both "a set of concentric permissions, outermost most
// permissive, and a thing that crosses an edge without a declaration". Today that is a paragraph
// ("Without a published stance the fleet has one undifferentiated risk surface…") over a list. Here
// the nesting IS the containment, each band carries its own `VizState` (so a declared-but-unenforced
// band renders as a dashed outline with no fill), and the `edge` is an explicit arrow crossing the
// outer boundary with its own count.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { fmtNum, isNum } from "@/components/org/viz/vizNum";
import {
  KICKER_SVG_CLASS,
  STATE_LABEL,
  VizDefs,
  isStruck,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
  type VizState,
} from "@/components/org/viz/states";

const W = 300;
const STEP = 24; // inset per band — also the height of a band's label strip
const PAD_Y = 12;

export type LadderBand = {
  id: string;
  /** Noun phrase naming the band, e.g. "Agent-authorable". */
  label: string;
  state: VizState;
  /** How many subjects sit in this band. Non-finite → the count is simply not printed. */
  count?: number | null;
  /** Score-derived paint, where the caller has one. */
  color?: string;
};

export type LadderEdge = {
  label: string;
  count?: number | null;
  /** Defaults to `missing` — something crossing with no declaration behind it. */
  state?: VizState;
};

export function BandLadder({
  bands,
  edge = null,
  title = "Bands",
  className = "",
}: {
  /** Outermost (most permissive) first. */
  bands: LadderBand[];
  /** What crosses the outer boundary without a declaration. */
  edge?: LadderEdge | null;
  title?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  if (bands.length === 0) {
    return (
      <div role="img" aria-label={`${title}: no bands declared`} className={`type-body-sm text-slate-500 ${className}`}>
        No bands declared
      </div>
    );
  }

  const H = bands.length * STEP * 2 + PAD_Y * 2 + (edge ? STEP : 0);
  const edgeState: VizState = edge?.state ?? "missing";

  const ariaLabel =
    `${title}: ${bands.length} nested bands, outermost first — ` +
    bands
      .map((b) => `${b.label} (${STATE_LABEL[b.state].toLowerCase()}${isNum(b.count) ? `, ${b.count}` : ""})`)
      .join("; ") +
    (edge ? `. ${isNum(edge.count) ? `${edge.count} ` : ""}${edge.label} crosses the outer boundary with no declaration behind it.` : ".");

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <VizDefs />
        {bands.map((b, i) => {
          const inset = i * STEP;
          const w = W - inset * 2;
          const h = H - (edge ? STEP : 0) - PAD_Y * 2 - inset * 2;
          if (w <= 0 || h <= 0) return null;
          return (
            <g
              key={b.id}
              style={{
                opacity: animate ? stateOpacity(b.state) : 0,
                transition: reduced ? undefined : `opacity 0.5s ease-out ${Math.min(i * 90, 450)}ms`,
              }}
            >
              <rect
                data-band={b.id}
                data-state={b.state}
                x={inset}
                y={PAD_Y + inset}
                width={w}
                height={h}
                rx={6}
                fill={stateFill(b.state, b.color)}
                fillOpacity={stateFillOpacity(b.state) * 0.16}
                stroke={stateStroke(b.state, b.color)}
                strokeWidth={stateStrokeWidth(b.state)}
                strokeDasharray={stateDash(b.state)}
              >
                <title>{stateTitle(b.state, b.label)}</title>
              </rect>
              <text x={inset + 8} y={PAD_Y + inset + 15} fontSize={10} className={KICKER_SVG_CLASS}>
                {b.label}
              </text>
              {/* A count is a measurement: it is printed only where the state permits a value. */}
              {isNum(b.count) && b.state !== "not-judged" && b.state !== "missing" && (
                <text
                  x={W - inset - 8}
                  y={PAD_Y + inset + 15}
                  textAnchor="end"
                  fontSize={11}
                  className="fill-slate-300 font-mono tabular-nums"
                >
                  {fmtNum(b.count, 0)}
                </text>
              )}
              {isStruck(b.state) && (
                <line
                  data-strike
                  x1={inset + 6}
                  y1={PAD_Y + inset + 11}
                  x2={W - inset - 6}
                  y2={PAD_Y + inset + 11}
                  stroke="var(--color-divider)"
                  strokeWidth={1.5}
                />
              )}
            </g>
          );
        })}

        {edge && (
          <g data-edge>
            <line
              x1={W / 2}
              y1={H - 4}
              x2={W / 2}
              y2={H - STEP - 4}
              stroke={edgeState === "missing" ? "var(--color-warn)" : stateStroke(edgeState)}
              strokeWidth={1.5}
              strokeDasharray={stateDash(edgeState) ?? "3 2"}
            />
            <path
              d={`M ${W / 2 - 4} ${H - STEP + 2} L ${W / 2} ${H - STEP - 4} L ${W / 2 + 4} ${H - STEP + 2} Z`}
              fill={edgeState === "missing" ? "var(--color-warn)" : stateStroke(edgeState)}
            />
            <text x={W / 2 + 10} y={H - 8} fontSize={10} className={KICKER_SVG_CLASS}>
              {`${isNum(edge.count) ? `${fmtNum(edge.count, 0)} ` : ""}${edge.label}`}
            </text>
            <title>{`${edge.label} crosses the outer boundary. ${stateTitle(edgeState)}`}</title>
          </g>
        )}
      </svg>

      <table className="sr-only">
        <caption>{`${title} — bands from most permissive to most restricted`}</caption>
        <thead>
          <tr>
            <th scope="col">Band</th>
            <th scope="col">State</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.id}>
              <th scope="row">{b.label}</th>
              <td>{STATE_LABEL[b.state]}</td>
              <td>{b.state === "not-judged" || b.state === "missing" ? "—" : fmtNum(b.count, 0)}</td>
            </tr>
          ))}
          {edge && (
            <tr>
              <th scope="row">{`${edge.label} (crosses the outer boundary)`}</th>
              <td>{STATE_LABEL[edgeState]}</td>
              <td>{fmtNum(edge.count, 0)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
