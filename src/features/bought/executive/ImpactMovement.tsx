// What the period actually MOVED, per dimension — a diverging bar on one symmetric axis.
//
// The ledger's byDim roll-up used to be a wrap-row of text chips: "D1 +6  D3 -2  D7 +1". A chip row
// is a table in disguise — the reader has to sort it and compare magnitudes arithmetically, which is
// exactly the translation work a briefing should have already done. Gains right, regressions left,
// one shared scale, biggest first.
//
// THE VOID. When nothing has been re-scanned (`dimPoints === null`) the chart draws a dashed zero
// axis and NO bars. A chart of zero-length bars would be a legible claim — "the period bought
// nothing" — and the ledger does not have that measurement; it has no measurement at all.
//
// Server-safe: no hooks, no handlers, no motion.

import { DIRECTION_TONE, deltaHex } from "@/components/ui";
import { VOID_DASH, stateTitle } from "@/components/org/viz";
import { type MovementRow, movementDomain } from "./impactView";

const W = 320;
const LABEL_W = 34;
const ROW_H = 20;
const BAR_H = 9;
const PAD_T = 4;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function ImpactMovement({
  rows,
  className = "",
}: {
  /** Empty ⇒ the void. Never synthesise a zero row to fill it. */
  rows: MovementRow[];
  className?: string;
}) {
  const plotW = W - LABEL_W;
  const axisX = LABEL_W + plotW / 2;
  const domain = movementDomain(rows);

  if (rows.length === 0 || domain === 0) {
    const label =
      rows.length === 0
        ? "Verified movement by dimension: nothing re-scanned yet, so there is no movement to draw."
        : "Verified movement by dimension: every re-scanned merge measured zero movement.";
    return (
      <div className={className}>
        <svg viewBox={`0 0 ${W} ${ROW_H + PAD_T * 2}`} className="h-auto w-full" role="img" aria-label={label}>
          <title>{label}</title>
          <line
            x1={axisX}
            y1={PAD_T}
            x2={axisX}
            y2={ROW_H + PAD_T}
            stroke="var(--color-divider)"
            strokeWidth={1}
            strokeDasharray={VOID_DASH}
          >
            <title>{stateTitle("missing", "Verified movement")}</title>
          </line>
          <text x={0} y={ROW_H} fontSize={9} className="fill-slate-500 font-mono">
            {rows.length === 0 ? "— nothing re-scanned" : "— no movement measured"}
          </text>
        </svg>
      </div>
    );
  }

  const H = rows.length * ROW_H + PAD_T * 2;
  const half = plotW / 2 - 34; // leave room for the readout outside the longest bar
  const len = (v: number) => Math.max(1.5, Math.round((Math.abs(v) / domain) * half * 100) / 100);

  const ariaLabel =
    `Verified movement by dimension, biggest first: ` +
    rows.map((r) => `${r.dimId} ${signed(r.points)} points over ${r.prs} ${r.prs === 1 ? "PR" : "PRs"}`).join("; ") +
    ". Gains right of the axis, regressions left, on one shared scale.";

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <line x1={axisX} y1={PAD_T} x2={axisX} y2={H - PAD_T} stroke="var(--color-divider)" strokeWidth={1} />
        {rows.map((r, i) => {
          const y = PAD_T + i * ROW_H + (ROW_H - BAR_H) / 2;
          const l = len(r.points);
          const up = r.points > 0;
          const x = up ? axisX : axisX - l;
          const color = deltaHex(r.points);
          return (
            <g key={r.dimId} data-dim={r.dimId} data-state={r.state}>
              <text x={0} y={y + BAR_H - 1} fontSize={9} className="fill-slate-400 font-mono">
                {r.dimId}
              </text>
              <rect x={x} y={y} width={l} height={BAR_H} rx={1.5} fill={color} fillOpacity={0.75} stroke={color} strokeWidth={0.75}>
                <title>{`${r.dimId}: ${signed(r.points)} verified dimension points over ${r.prs} ${r.prs === 1 ? "PR" : "PRs"}`}</title>
              </rect>
              <text
                x={up ? x + l + 4 : x - 4}
                y={y + BAR_H - 1}
                fontSize={9}
                textAnchor={up ? "start" : "end"}
                className="font-mono tabular-nums"
                fill={color}
              >
                {signed(r.points)}
              </text>
            </g>
          );
        })}
        {/* The axis is labelled so a reader never has to infer which side is which. */}
        <text x={axisX + 3} y={H - 1} fontSize={7} fill={DIRECTION_TONE.rising.color} className="font-mono uppercase tracking-widest">
          bought
        </text>
        <text
          x={axisX - 3}
          y={H - 1}
          fontSize={7}
          textAnchor="end"
          fill={DIRECTION_TONE.falling.color}
          className="font-mono uppercase tracking-widest"
        >
          regressed
        </text>
      </svg>

      <table className="sr-only">
        <caption>Verified dimension movement over the period</caption>
        <thead>
          <tr>
            <th scope="col">Dimension</th>
            <th scope="col">Points</th>
            <th scope="col">Verified PRs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.dimId}>
              <th scope="row">{r.dimId}</th>
              <td>{signed(r.points)}</td>
              <td>{r.prs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
