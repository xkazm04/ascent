"use client";

// A horizontal quartile strip — min · q1 · median · q3 · max, with an optional "you" marker.
//
// Replaces the sentence "quartiles across everyone sharing" and its cousins: a reader comparing
// themselves to a fleet needs the SHAPE of the distribution and their position in it, which is a
// box plot, not three numbers in a paragraph. Dependency-free SVG; the `<title>`, the aria-label and
// the sr-only table are all generated from the same five numbers the geometry is.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { Kicker } from "@/components/ui";
import { fmtNum, isNum, r2 } from "@/components/org/viz/vizNum";

const W = 280;
const H = 46;
const PAD_X = 10;
const TRACK_Y = 22;
const BOX_H = 14;
const MONO = "font-mono tabular-nums";

export type DistributionProps = {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** The viewer's own value. Omitted or non-finite → no marker (never plotted at 0). */
  you?: number | null;
  /** Population size behind the quartiles. */
  n?: number | null;
  /** Noun phrase naming the measure, e.g. "AI-authored share". Used in the accessible name. */
  label?: string;
  /** Unit suffix for the readouts, e.g. "%". */
  unit?: string;
  digits?: number;
  className?: string;
};

export function Distribution({
  min,
  q1,
  median,
  q3,
  max,
  you = null,
  n = null,
  label = "Distribution",
  unit = "",
  digits = 1,
  className = "",
}: DistributionProps) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  const five = [min, q1, median, q3, max];
  // A quartile set with a hole in it is not a distribution — degrade to a labelled placeholder
  // rather than plotting a NaN box (the RadarChart empty-set precedent).
  if (!five.every(isNum)) {
    return (
      <div
        role="img"
        aria-label={`${label}: no distribution data`}
        className={`type-body-sm text-slate-500 ${className}`}
      >
        No distribution data
      </div>
    );
  }

  const lo = Math.min(...five);
  const hi = Math.max(...five);
  const span = hi - lo;
  const plotW = W - PAD_X * 2;
  // A degenerate (zero-width) domain would divide by zero: park every mark at the centre instead.
  const x = (v: number) => r2(span > 0 ? PAD_X + ((Math.max(lo, Math.min(hi, v)) - lo) / span) * plotW : PAD_X + plotW / 2);

  const yourValue = isNum(you) ? you : null;
  const outOfRange = yourValue !== null && (yourValue < lo || yourValue > hi);
  const fmt = (v: number) => `${fmtNum(v, digits)}${unit}`;

  const rows: { key: string; name: string; value: number }[] = [
    { key: "min", name: "Minimum", value: min },
    { key: "q1", name: "First quartile", value: q1 },
    { key: "median", name: "Median", value: median },
    { key: "q3", name: "Third quartile", value: q3 },
    { key: "max", name: "Maximum", value: max },
  ];
  if (yourValue !== null) rows.push({ key: "you", name: "You", value: yourValue });

  const ariaLabel =
    `${label}: ${rows.map((r) => `${r.name.toLowerCase()} ${fmt(r.value)}`).join(", ")}` +
    (isNum(n) ? `, across ${n}` : "") +
    (outOfRange ? ". Your value sits outside the plotted range and is drawn at the edge." : ".");

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        {/* whiskers: the full min..max reach */}
        <line x1={x(min)} x2={x(max)} y1={TRACK_Y} y2={TRACK_Y} stroke="var(--color-divider)" strokeWidth={2} strokeLinecap="round" />
        <line x1={x(min)} x2={x(min)} y1={TRACK_Y - 6} y2={TRACK_Y + 6} stroke="var(--color-divider)" strokeWidth={1.5} />
        <line x1={x(max)} x2={x(max)} y1={TRACK_Y - 6} y2={TRACK_Y + 6} stroke="var(--color-divider)" strokeWidth={1.5} />

        {/* the interquartile box — grows out of the median on entrance */}
        <g
          style={{
            transform: animate ? "scaleX(1)" : "scaleX(0.02)",
            transformBox: "fill-box",
            transformOrigin: "center",
            transition: reduced ? undefined : "transform 0.7s ease-out",
          }}
        >
          <rect
            data-box
            x={x(q1)}
            y={TRACK_Y - BOX_H / 2}
            width={Math.max(1, x(q3) - x(q1))}
            height={BOX_H}
            rx={2}
            fill="var(--color-accent)"
            fillOpacity={0.18}
            stroke="var(--color-accent)"
            strokeWidth={1}
          />
        </g>
        {/* median */}
        <line data-median x1={x(median)} x2={x(median)} y1={TRACK_Y - BOX_H / 2 - 2} y2={TRACK_Y + BOX_H / 2 + 2} stroke="var(--color-accent)" strokeWidth={2} />

        {/* the viewer's own position — a filled dot with a dark keyline so it reads over the box */}
        {yourValue !== null && (
          <g style={{ opacity: animate ? 1 : 0, transition: reduced ? undefined : "opacity 0.7s ease-out 0.2s" }}>
            <circle data-you cx={x(yourValue)} cy={TRACK_Y} r={4.5} fill="var(--color-accent-soft)" stroke="var(--color-surface-strong)" strokeWidth={1.5} />
            <title>{`You: ${fmt(yourValue)}${outOfRange ? " (outside the plotted range, drawn at the edge)" : ""}`}</title>
          </g>
        )}

        {/* domain end labels */}
        <text x={PAD_X} y={H - 4} className={`fill-slate-500 ${MONO}`} fontSize={10}>{fmt(lo)}</text>
        <text x={W - PAD_X} y={H - 4} textAnchor="end" className={`fill-slate-500 ${MONO}`} fontSize={10}>{fmt(hi)}</text>
      </svg>

      {isNum(n) && (
        <Kicker tone="muted" className="mt-1">
          n = <span className="tabular-nums">{n}</span>
        </Kicker>
      )}

      <table className="sr-only">
        <caption>{`${label} — quartiles`}</caption>
        <thead>
          <tr>
            <th scope="col">Statistic</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.name}</th>
              <td>{fmt(r.value)}</td>
            </tr>
          ))}
          {isNum(n) && (
            <tr>
              <th scope="row">Population</th>
              <td>{n}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
