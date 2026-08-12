// The decay curve for one repo's context file — a dependency-free SVG in the house chart style
// (see Sparkline.tsx / the landing TrajectoryChart). Time runs left→right from "last edited" to
// "now"; the curve is the exponential potency decay under the repo's commit rate, the 50% rule is
// the half-life marker, and the dot is where this repo sits today.
//
// Extracted from ContextHalfLife.tsx so both that variant and any future consumer share one curve
// (and so neither file approaches the 300-LOC cap).

import { scoreHex } from "@/lib/ui";

export function HalfLifeCurve({
  potency,
  width = 132,
  height = 34,
  ariaLabel,
}: {
  /** 0..100 remaining potency — the curve is sampled so it ends exactly here. */
  potency: number;
  width?: number;
  height?: number;
  ariaLabel?: string;
}) {
  const p = Math.max(0, Math.min(100, potency));
  const hex = scoreHex(p);
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  // Solve for the decay constant that lands the curve on `p` at t = 1 (now).
  const k = p <= 0 ? 6 : Math.min(6, -Math.log(Math.max(p, 1) / 100));
  const pts: string[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = 100 * Math.exp(-k * t);
    pts.push(`${(pad + t * w).toFixed(1)},${(pad + (1 - y / 100) * h).toFixed(1)}`);
  }
  const cx = pad + w;
  const cy = pad + (1 - p / 100) * h;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel ?? `Context potency ${p}%`}
      className="shrink-0"
    >
      {/* Half-life rule — where the context is half wrong. */}
      <line x1={pad} y1={pad + h / 2} x2={pad + w} y2={pad + h / 2} stroke="#1e293b" strokeWidth={1} strokeDasharray="2 3" />
      <polyline points={pts.join(" ")} fill="none" stroke={hex} strokeWidth={1.5} strokeOpacity={0.9} />
      <circle cx={cx} cy={cy} r={2.6} fill={hex} />
    </svg>
  );
}

/** Fleet-level decay band: one thin stacked bar of the fresh / aging / stale / absent split. */
export function BandBar({ counts, total }: { counts: { fresh: number; aging: number; stale: number; absent: number }; total: number }) {
  const segs: { key: string; n: number; hex: string; label: string }[] = [
    { key: "fresh", n: counts.fresh, hex: scoreHex(90), label: "Fresh" },
    { key: "aging", n: counts.aging, hex: scoreHex(55), label: "Aging" },
    { key: "stale", n: counts.stale, hex: scoreHex(25), label: "Stale" },
    { key: "absent", n: counts.absent, hex: "#334155", label: "Absent" },
  ];
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-800" role="img" aria-label="Fleet context freshness split">
        {segs.map((s) =>
          s.n > 0 ? <div key={s.key} style={{ width: `${(s.n / Math.max(1, total)) * 100}%`, backgroundColor: s.hex }} /> : null,
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
        {segs.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: s.hex }} />
            {s.label} <span className="tabular-nums text-slate-400">{s.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
