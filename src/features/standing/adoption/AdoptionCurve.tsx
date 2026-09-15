"use client";

// The adoption curve: what share of contributors carry at least t% AI-attributed work.
//
// Replaces the segmented bar and the sentence above it ("Every contributor, by how much of their own
// recent work is AI-attributed"). Three MEASURED points, a hatched `not-judged` envelope where the
// producer buckets rather than observes, and — the part the bar could not say — nothing at all drawn
// through the interior, because we did not look there. Dependency-free SVG on the shared kit; every
// paint comes from `stateFill`/`stateStroke` or a design token, never a hand-picked hex.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import {
  DEFAULT_BASE,
  HATCH_ID,
  KICKER_SVG_CLASS,
  VizDefs,
  r2,
  stateFill,
  stateStroke,
  stateTitle,
} from "@/components/org/viz";
import { curveSummary, type AdoptionCurveModel } from "./adoptionCurveModel";

const W = 340;
const H = 152;
const PAD_L = 30;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 28;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const Y_TICKS = [0, 50, 100];

const x = (threshold: number) => r2(PAD_L + (threshold / 100) * PLOT_W);
const y = (share: number) => r2(PAD_T + (1 - share / 100) * PLOT_H);

export function AdoptionCurve({ model, className = "" }: { model: AdoptionCurveModel; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  // A population of zero is not a flat curve — degrade to a labelled placeholder rather than
  // plotting a NaN geometry (the kit's RadarChart empty-set precedent).
  if (!model.ok) {
    return (
      <div role="img" aria-label="Adoption curve: no contributor population to plot" className={`type-body-sm text-slate-500 ${className}`}>
        No contributor population to plot
      </div>
    );
  }

  const label = curveSummary(model);
  const baseline = y(0);

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        <title>{label}</title>
        <VizDefs />

        {Y_TICKS.map((t) => (
          <g key={t}>
            <line x1={PAD_L} y1={y(t)} x2={W - PAD_R} y2={y(t)} stroke="var(--color-divider)" strokeWidth={1} strokeOpacity={t === 0 ? 1 : 0.35} />
            <text x={PAD_L - 5} y={y(t) + 3} textAnchor="end" fontSize={8} className={KICKER_SVG_CLASS}>
              {t}
            </text>
          </g>
        ))}

        {/* The unobserved interior. Hatched, bounded, and carrying no numeral — the curve provably
            lies inside each band, and drawing a line through it would assert a shape we never read. */}
        {model.gaps.map((g) => (
          <rect
            key={`${g.from}-${g.to}`}
            data-gap={`${g.from}-${g.to}`}
            x={x(g.from)}
            y={y(g.hi)}
            width={r2(x(g.to) - x(g.from))}
            height={r2(y(g.lo) - y(g.hi))}
            fill={`url(#${HATCH_ID})`}
            fillOpacity={0.55}
            stroke={stateStroke("not-judged")}
            strokeWidth={1}
          >
            <title>{stateTitle("not-judged", `Between ${g.from}% and ${g.to}% AI share`)}</title>
          </rect>
        ))}

        {model.orgShare != null && (
          <g data-org-share>
            <line
              x1={x(model.orgShare)}
              y1={PAD_T}
              x2={x(model.orgShare)}
              y2={baseline}
              stroke={DEFAULT_BASE}
              strokeWidth={1}
              strokeOpacity={0.45}
            />
            <title>{`Org commit-weighted AI share: ${Math.round(model.orgShare)}% — the fleet's single figure, plotted on the same threshold axis.`}</title>
          </g>
        )}

        {model.marks.map((k, i) => (
          <g
            key={k.threshold}
            data-mark={k.threshold}
            style={{
              opacity: animate ? 1 : 0,
              transition: reduced ? undefined : `opacity 0.4s ease-out ${Math.min(i * 90, 360)}ms`,
            }}
          >
            <line x1={x(k.threshold)} y1={y(k.share)} x2={x(k.threshold)} y2={baseline} stroke={DEFAULT_BASE} strokeWidth={1} strokeOpacity={0.3} />
            <circle cx={x(k.threshold)} cy={y(k.share)} r={4} fill={stateFill("measured", DEFAULT_BASE)} stroke={stateStroke("measured", DEFAULT_BASE)} strokeWidth={1} />
            <text x={x(k.threshold)} y={H - 16} textAnchor={k.threshold === 0 ? "start" : k.threshold === 100 ? "end" : "middle"} fontSize={8} className={KICKER_SVG_CLASS}>
              {k.label}
            </text>
            <text x={x(k.threshold)} y={H - 5} textAnchor={k.threshold === 0 ? "start" : "middle"} fontSize={9} className="fill-slate-300 font-mono tabular-nums">
              {k.count}
            </text>
            <title>{`${k.count} of ${model.total} contributors at ${k.label} — ${Math.round(k.share)}% of the population.`}</title>
          </g>
        ))}
      </svg>

      <table className="sr-only">
        <caption>Adoption curve — contributors at or above each measured AI-share threshold</caption>
        <thead>
          <tr>
            <th scope="col">Threshold</th>
            <th scope="col">Contributors</th>
            <th scope="col">Share of population</th>
          </tr>
        </thead>
        <tbody>
          {model.marks.map((k) => (
            <tr key={k.threshold}>
              <th scope="row">{k.label}</th>
              <td>{k.count}</td>
              <td>{Math.round(k.share)}%</td>
            </tr>
          ))}
          {model.unclassified > 0 && (
            <tr>
              <th scope="row">No AI-share reading</th>
              <td>{model.unclassified}</td>
              <td>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
