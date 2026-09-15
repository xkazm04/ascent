"use client";

// A Lorenz curve for contribution concentration — the bus-factor risk, drawn.
//
// "Two people wrote 71% of everything" is a sentence a reader has to trust. The curve shows the same
// fact as a shape: the further it sags below the equality diagonal, the more the work is carried by
// a few. The shaded area IS the Gini coefficient, and the marked knee is the point of maximum sag —
// the smallest group whose absence would hurt most.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { Kicker } from "@/components/ui";
import { fmtNum, r2 } from "@/components/org/viz/vizNum";
import { KICKER_SVG_CLASS } from "@/components/org/viz/states";
import { concentrationOf, type LorenzPoint } from "@/components/org/viz/lorenz";

const W = 240;
const H = 210;
const PAD_L = 30;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 30;

export function ConcentrationCurve({
  values,
  subjectLabel = "contributors",
  valueLabel = "output",
  title = "Concentration",
  className = "",
}: {
  /** One magnitude per subject, any order. Non-finite and negative entries are dropped. */
  values: number[];
  subjectLabel?: string;
  valueLabel?: string;
  title?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  const c = concentrationOf(values);
  if (!c) {
    // Fewer than two usable values, or nothing but zeros: a straight diagonal would read as
    // "perfectly even", which is a claim the data cannot support.
    return (
      <div role="img" aria-label={`${title}: not enough data to measure concentration`} className={`type-body-sm text-slate-500 ${className}`}>
        Not enough data to measure concentration
      </div>
    );
  }

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const px = (v: number) => r2(PAD_L + v * plotW);
  const py = (v: number) => r2(PAD_T + (1 - v) * plotH);
  const at = (p: LorenzPoint) => `${px(p.x)},${py(p.y)}`;

  const curve = c.points.map(at).join(" ");
  // The gini area: down the curve, then back along the diagonal. One closed path, one fill.
  const area = `M ${at(c.points[0] as LorenzPoint)} L ${c.points.slice(1).map(at).join(" L ")} L ${px(1)},${py(1)} Z`;
  const kneePct = Math.round(c.knee.x * 100);
  const kneeShare = Math.round((1 - c.knee.y) * 100);

  const ariaLabel =
    `${title}: ${c.n} ${subjectLabel}, Gini ${c.gini.toFixed(2)}. ` +
    `The top ${100 - kneePct}% of ${subjectLabel} produce ${kneeShare}% of ${valueLabel}. ` +
    `Bus factor ${c.busFactor}: ${c.busFactor} of ${c.n} ${subjectLabel} cover half the total.`;

  // Sample the sr-only table: every point for a small set, deciles for a large one, so a 400-person
  // org does not push 400 rows into the accessibility tree.
  const tableRows = sampleRows(c.points);

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        {/* plot frame */}
        <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="none" stroke="var(--color-divider)" strokeWidth={1} />
        {/* equality diagonal — where every contributor carries the same share */}
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} stroke="var(--color-divider)" strokeWidth={1} strokeDasharray="3 3" />

        <g style={{ opacity: animate ? 1 : 0, transition: reduced ? undefined : "opacity 0.6s ease-out" }}>
          <path data-gini d={area} fill="var(--color-accent)" fillOpacity={0.12} />
        </g>
        <polyline
          data-curve
          points={curve}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          pathLength={1}
          strokeDasharray={reduced ? undefined : 1}
          style={{
            strokeDashoffset: reduced ? undefined : animate ? 0 : 1,
            transition: reduced ? undefined : "stroke-dashoffset 0.9s ease-out",
          }}
        />
        {/* the knee — the largest sag below equality */}
        <line x1={px(c.knee.x)} y1={py(c.knee.y)} x2={px(c.knee.x)} y2={py(c.knee.x)} stroke="var(--color-warn)" strokeWidth={1} strokeDasharray="2 2" />
        <circle data-knee cx={px(c.knee.x)} cy={py(c.knee.y)} r={4} fill="var(--color-warn)" stroke="var(--color-surface-strong)" strokeWidth={1.5}>
          <title>{`Risk knee: the top ${100 - kneePct}% of ${subjectLabel} produce ${kneeShare}% of ${valueLabel}.`}</title>
        </circle>

        <text x={PAD_L} y={H - 8} fontSize={9} className={KICKER_SVG_CLASS}>
          {subjectLabel}
        </text>
        <text x={W - PAD_R} y={H - 8} textAnchor="end" fontSize={9} className={KICKER_SVG_CLASS}>
          100%
        </text>
        <text x={8} y={PAD_T + 8} fontSize={9} className={KICKER_SVG_CLASS} transform={`rotate(-90 8 ${PAD_T + 8})`}>
          {valueLabel}
        </text>
      </svg>

      <Kicker tone="muted" className="mt-1">
        Gini <span className="tabular-nums">{c.gini.toFixed(2)}</span> · bus factor{" "}
        <span className="tabular-nums">{c.busFactor}</span> of <span className="tabular-nums">{c.n}</span>
      </Kicker>

      <table className="sr-only">
        <caption>{`${title} — cumulative share of ${valueLabel} by ${subjectLabel}`}</caption>
        <thead>
          <tr>
            <th scope="col">{`Share of ${subjectLabel}`}</th>
            <th scope="col">{`Cumulative share of ${valueLabel}`}</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map((p) => (
            <tr key={`${p.x}-${p.y}`}>
              <th scope="row">{`${fmtNum(p.x * 100, 0)}%`}</th>
              <td>{`${fmtNum(p.y * 100, 0)}%`}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Gini coefficient</th>
            <td>{c.gini.toFixed(2)}</td>
          </tr>
          <tr>
            <th scope="row">Bus factor</th>
            <td>{`${c.busFactor} of ${c.n}`}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Every point up to 12, otherwise 11 evenly spaced samples (0%, 10%, … 100%). */
function sampleRows(points: LorenzPoint[]): LorenzPoint[] {
  if (points.length <= 12) return points;
  const out: LorenzPoint[] = [];
  for (let i = 0; i <= 10; i++) {
    const idx = Math.round((i / 10) * (points.length - 1));
    const p = points[idx];
    if (p) out.push(p);
  }
  return out;
}
