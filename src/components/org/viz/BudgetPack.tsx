"use client";

// A packing bar — what fit in the budget, and (the point) what did not.
//
// The memory recall panel's own rule is that the interesting half is the OMISSIONS: a budget bar
// showing "38 of 40 used" hides the twelve candidates that lost. This draws both — the used-vs-budget
// fill on top, then one block per omission reason, width proportional to its count and painted by
// that reason's `VizState` (a candidate dropped because it was never judged hatches; one dropped
// because there was no measurement is a void, not a zero-width nothing).

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { Kicker } from "@/components/ui";
import { fmtNum, isNum, pct, r2 } from "@/components/org/viz/vizNum";
import {
  KICKER_SVG_CLASS,
  STATE_LABEL,
  VizDefs,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
  type VizState,
} from "@/components/org/viz/states";

const W = 300;
const BAR_Y = 6;
const BAR_H = 16;
const OMIT_Y = 40;
const OMIT_H = 14;
const H = 74;

export type Omission = {
  id: string;
  /** Why these candidates lost, e.g. "over token budget". A noun phrase, not a sentence. */
  label: string;
  count: number;
  state: VizState;
  color?: string;
};

export function BudgetPack({
  used,
  budget,
  unit = "",
  omissions = [],
  label = "Budget",
  className = "",
}: {
  used: number;
  budget: number;
  unit?: string;
  /** The losers, grouped by reason. An empty array renders the bar alone. */
  omissions?: Omission[];
  label?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  const safeBudget = isNum(budget) && budget > 0 ? budget : 0;
  const fillPct = pct(used, safeBudget);
  const kept = omissions.filter((o) => isNum(o.count) && o.count > 0);
  const omitTotal = kept.reduce((a, o) => a + o.count, 0);

  const ariaLabel =
    `${label}: ${fmtNum(used)}${unit} of ${safeBudget > 0 ? `${fmtNum(safeBudget)}${unit}` : "an unstated budget"} used` +
    (kept.length > 0
      ? `. ${omitTotal} omitted — ` +
        kept.map((o) => `${o.count} ${o.label} (${STATE_LABEL[o.state].toLowerCase()})`).join(", ") +
        "."
      : ". Nothing was omitted.");

  // Block widths are proportional to counts; a 3-unit floor keeps a single-item reason visible
  // rather than sub-pixel, and the prefix sum keeps the strip contiguous. Built as a pure prefix sum
  // (not a running mutation) so the render stays free of reassignment.
  const widths = kept.map((o) => Math.max(3, r2((o.count / Math.max(1, omitTotal)) * W)));
  const blocks = kept.map((o, i) => ({
    ...o,
    w: widths[i] ?? 3,
    x: widths.slice(0, i).reduce((a, b) => a + b, 0),
  }));

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <VizDefs />

        {/* the budget track + what was packed into it */}
        <rect x={0} y={BAR_Y} width={W} height={BAR_H} rx={3} fill="var(--color-surface-strong)" stroke="var(--color-divider)" strokeWidth={1} />
        <g
          style={{
            transform: animate ? "scaleX(1)" : "scaleX(0)",
            transformBox: "fill-box",
            transformOrigin: "left",
            transition: reduced ? undefined : "transform 0.7s ease-out",
          }}
        >
          <rect data-used x={0} y={BAR_Y} width={r2((fillPct / 100) * W)} height={BAR_H} rx={3} fill="var(--color-accent)" fillOpacity={0.55} />
        </g>
        <text x={4} y={BAR_Y + BAR_H + 12} fontSize={10} className={KICKER_SVG_CLASS}>
          Packed
        </text>
        <text x={W - 4} y={BAR_Y + BAR_H + 12} textAnchor="end" fontSize={11} className="fill-slate-300 font-mono tabular-nums">
          {`${fmtNum(used)}${unit} / ${safeBudget > 0 ? `${fmtNum(safeBudget)}${unit}` : "—"}`}
        </text>

        {/* the losers */}
        {blocks.map((b, i) => (
          <g
            key={b.id}
            style={{
              opacity: animate ? 1 : 0,
              transition: reduced ? undefined : `opacity 0.5s ease-out ${Math.min(i * 70, 420)}ms`,
            }}
          >
            <rect
              data-omission={b.id}
              data-state={b.state}
              x={b.x}
              y={OMIT_Y}
              width={b.w}
              height={OMIT_H}
              rx={2}
              fill={stateFill(b.state, b.color)}
              fillOpacity={stateFillOpacity(b.state) * 0.45}
              stroke={stateStroke(b.state, b.color)}
              strokeWidth={stateStrokeWidth(b.state)}
              strokeDasharray={stateDash(b.state)}
            >
              <title>{`${b.count} ${b.label}. ${stateTitle(b.state)}`}</title>
            </rect>
          </g>
        ))}
        {blocks.length > 0 && (
          <text x={0} y={OMIT_Y + OMIT_H + 12} fontSize={10} className={KICKER_SVG_CLASS}>
            {`Omitted · ${omitTotal}`}
          </text>
        )}
      </svg>

      {blocks.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center gap-1.5" title={STATE_LABEL[b.state]}>
              <span className="font-mono type-mono-sm tabular-nums text-slate-300">{b.count}</span>
              <Kicker tone="muted" as="span">
                {b.label}
              </Kicker>
            </li>
          ))}
        </ul>
      )}

      <table className="sr-only">
        <caption>{`${label} — packed and omitted`}</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">State</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Packed</th>
            <td>{STATE_LABEL.measured}</td>
            <td>{`${fmtNum(used)}${unit}`}</td>
          </tr>
          <tr>
            <th scope="row">Budget</th>
            <td>{STATE_LABEL.decided}</td>
            <td>{safeBudget > 0 ? `${fmtNum(safeBudget)}${unit}` : "—"}</td>
          </tr>
          {kept.map((o) => (
            <tr key={o.id}>
              <th scope="row">{`Omitted: ${o.label}`}</th>
              <td>{STATE_LABEL[o.state]}</td>
              <td>{o.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
