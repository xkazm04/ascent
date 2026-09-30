// Trend: the kit's small maturity trend (`data-kit="trend"`): 240x56, drawn against the LEVEL BANDS the series
// touches (padded one band) rather than an autoscaled range, with hairline band edges and 13px edge labels, a
// paper stroke, a faint area, the first and last values printed, and an end dot ringed in void. A series shorter
// than the forecast minimum is not a line: it says so in words (a two-point "trend" is a slope of noise).
// Server-safe. Paper and hairline come from tokens, so it follows the theme; it is a Prism part (v2 callers).
import { useId } from "react";
import { MIN_FORECAST_POINTS } from "@/lib/maturity/forecast";
import { bandDomain, type TrendDomain } from "./trendDomain";

const W = 240;
const H = 56;
const X0 = 40;
const X1 = 204;
const Y0 = 7;
const Y1 = 49;
const LABEL_GAP = 14;
const PAPER = "color-mix(in srgb, var(--color-white) 85%, transparent)";

export function Trend({
  values,
  label,
  min = MIN_FORECAST_POINTS,
  domain,
  className = "",
}: {
  /** Scores 0..100, oldest first. */
  values: readonly number[];
  /** What the series is over ("last 30 days"): named in the accessible label and the empty words. */
  label: string;
  /** Fewest points that draw a line; default is the forecast minimum. */
  min?: number;
  /** Override the band domain (a fixed ruler shared by several trends). */
  domain?: TrendDomain;
  className?: string;
}) {
  const gid = useId().replace(/:/g, "");
  if (values.length < min) {
    return (
      <p data-kit="trend" data-role="trend-empty" className={`type-caption text-slate-400 ${className}`}>
        {values.length === 0 ? "No scans" : `${values.length} of ${min} scans`} {label}: a trend needs at least {min}.
      </p>
    );
  }
  const d = domain ?? bandDomain(values);
  const span = Math.max(1, d.hi - d.lo);
  const x = (i: number) => X0 + (i / (values.length - 1)) * (X1 - X0);
  const y = (v: number) => Y1 - ((Math.max(d.lo, Math.min(d.hi, v)) - d.lo) / span) * (Y1 - Y0);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const first = values[0]!;
  const last = values[values.length - 1]!;
  // Edges whose label would sit within LABEL_GAP of the last shown label keep their line but lose the text.
  const edges = d.edges.reduce<{ at: number; level: string; ey: number; show: boolean }[]>((acc, e) => {
    const ey = y(e.at);
    const shown = acc.filter((p) => p.show);
    const last = shown[shown.length - 1];
    acc.push({ ...e, ey, show: !last || Math.abs(last.ey - ey) >= LABEL_GAP });
    return acc;
  }, []);
  return (
    <div data-kit="trend" data-role="trend" className={className}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Maturity ${label}: ${first} to ${last} over ${values.length} scans`} className="block max-w-full">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-white)" stopOpacity="0.1" />
            <stop offset="1" stopColor="var(--color-white)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {edges.map((e) => (
          <g key={e.level} data-role="trend-edge">
            <line x1={X0} x2={X1} y1={e.ey} y2={e.ey} stroke="var(--hair, var(--color-divider))" strokeWidth={1} />
            {e.show && (
              <text x={X0 - 6} y={e.ey + 4.5} textAnchor="end" fontSize={13} fill="var(--color-slate-400)" style={{ fontFamily: "var(--font-sans)" }}>
                {e.level}
              </text>
            )}
          </g>
        ))}
        <path d={`${line} L${X1} ${Y1} L${X0} ${Y1} Z`} fill={`url(#${gid})`} stroke="none" />
        <path d={line} fill="none" stroke={PAPER} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <circle data-role="trend-end" cx={X1} cy={y(last)} r={3} fill="var(--color-white)" stroke="var(--color-ink)" strokeWidth={2} />
        <text data-role="trend-first" x={X0} y={y(first) > Y0 + 8 ? y(first) - 7 : y(first) + 15} fontSize={13} fill="var(--color-slate-300)" style={{ fontFamily: "var(--font-sans)" }}>
          {first}
        </text>
        <text data-role="trend-last" x={X1 + 9} y={y(last) + 4.5} fontSize={13} fontWeight={600} fill="var(--color-white)" style={{ fontFamily: "var(--font-sans)" }}>
          {last}
        </text>
      </svg>
    </div>
  );
}
