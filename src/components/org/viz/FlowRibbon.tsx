"use client";

// A proportional 3-stage ribbon — spend → output → reviewed.
//
// Unit economics are a chain, and a chain is where an absence matters most: if nothing measured how
// much of the output was reviewed, the honest drawing is a BREAK in the ribbon, not a stage of
// height zero ("an em dash is a missing measurement, not a zero"). A stage whose value is null or
// non-finite therefore renders as `missing`: a dashed void with no fill, and the connectors either
// side of it are not drawn.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { fmtNum, isNum, r2 } from "@/components/org/viz/vizNum";
import {
  KICKER_SVG_CLASS,
  STATE_LABEL,
  VizDefs,
  VOID_DASH,
  isVoid,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
  type VizState,
} from "@/components/org/viz/states";

const W = 320;
const H = 120;
const PAD_Y = 22;
const STAGE_W = 20;

export type FlowStage = {
  id: string;
  /** Noun phrase, e.g. "Spend". */
  label: string;
  /** null / non-finite → the stage is `missing` and draws as a void, never as 0. */
  value: number | null;
  /** Defaults to `measured` (or `missing` when the value is absent). */
  state?: VizState;
  unit?: string;
  color?: string;
};

export function FlowRibbon({
  stages,
  title = "Flow",
  className = "",
}: {
  /** Ordered stages — three is the shape this was built for (spend → output → reviewed). */
  stages: FlowStage[];
  title?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  if (stages.length < 2) {
    return (
      <div role="img" aria-label={`${title}: not enough stages to draw a flow`} className={`type-body-sm text-slate-500 ${className}`}>
        Not enough stages to draw a flow
      </div>
    );
  }

  const resolved = stages.map((s) => {
    const value = isNum(s.value) && s.value >= 0 ? s.value : null;
    const state: VizState = value === null ? "missing" : (s.state ?? "measured");
    return { ...s, value, state };
  });
  const max = Math.max(0, ...resolved.map((s) => s.value ?? 0));
  const plotH = H - PAD_Y * 2;
  const thick = (v: number | null) => (v === null || max <= 0 ? 0 : Math.max(2, r2((v / max) * plotH)));
  const gap = (W - STAGE_W * resolved.length) / Math.max(1, resolved.length - 1);
  const xOf = (i: number) => r2(i * (STAGE_W + gap));
  const midY = PAD_Y + plotH / 2;

  const ariaLabel =
    `${title}: ` +
    resolved
      .map((s) =>
        s.value === null
          ? `${s.label} not measured`
          : `${s.label} ${fmtNum(s.value)}${s.unit ?? ""}`,
      )
      .join(" then ") +
    ". Stage thickness is proportional to value; an unmeasured stage is drawn as a break, not as zero.";

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <VizDefs />

        <g
          style={{
            opacity: animate ? 1 : 0,
            transition: reduced ? undefined : "opacity 0.6s ease-out",
          }}
        >
          {/* connectors — drawn only where BOTH ends are measured; a break is the encoding */}
          {resolved.slice(0, -1).map((s, i) => {
            const next = resolved[i + 1];
            if (!next || isVoid(s.state) || isVoid(next.state)) return null;
            const a = thick(s.value) / 2;
            const b = thick(next.value) / 2;
            const x1 = xOf(i) + STAGE_W;
            const x2 = xOf(i + 1);
            return (
              <path
                key={`c-${s.id}`}
                data-connector={s.id}
                d={`M ${x1} ${midY - a} L ${x2} ${midY - b} L ${x2} ${midY + b} L ${x1} ${midY + a} Z`}
                fill="var(--color-accent)"
                fillOpacity={0.12}
              />
            );
          })}

          {/* the stages */}
          {resolved.map((s, i) => {
            const t = thick(s.value);
            const x = xOf(i);
            return (
              <g key={s.id}>
                {isVoid(s.state) ? (
                  // The void: a dashed outline the height of the plot, deliberately empty. It marks
                  // WHERE the measurement is missing without asserting a magnitude for it.
                  <rect
                    data-stage={s.id}
                    data-state={s.state}
                    x={x}
                    y={PAD_Y}
                    width={STAGE_W}
                    height={plotH}
                    rx={3}
                    fill="none"
                    stroke="var(--color-divider)"
                    strokeWidth={1}
                    strokeDasharray={VOID_DASH}
                  >
                    <title>{stateTitle(s.state, s.label)}</title>
                  </rect>
                ) : (
                  <rect
                    data-stage={s.id}
                    data-state={s.state}
                    x={x}
                    y={r2(midY - t / 2)}
                    width={STAGE_W}
                    height={t}
                    rx={3}
                    fill={stateFill(s.state, s.color)}
                    fillOpacity={stateFillOpacity(s.state) * 0.75}
                    stroke={stateStroke(s.state, s.color)}
                    strokeWidth={stateStrokeWidth(s.state)}
                    strokeDasharray={stateDash(s.state)}
                  >
                    <title>{stateTitle(s.state, `${s.label}: ${fmtNum(s.value)}${s.unit ?? ""}`)}</title>
                  </rect>
                )}
                <text x={x + STAGE_W / 2} y={H - 8} textAnchor="middle" fontSize={10} className={KICKER_SVG_CLASS}>
                  {s.label}
                </text>
                <text x={x + STAGE_W / 2} y={12} textAnchor="middle" fontSize={11} className="fill-slate-300 font-mono tabular-nums">
                  {/* An unmeasured stage prints an em dash. It must never print 0. */}
                  {s.value === null ? "—" : `${fmtNum(s.value)}${s.unit ?? ""}`}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <table className="sr-only">
        <caption>{`${title} — stages`}</caption>
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">State</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {resolved.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.label}</th>
              <td>{STATE_LABEL[s.state]}</td>
              <td>{s.value === null ? "—" : `${fmtNum(s.value)}${s.unit ?? ""}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
