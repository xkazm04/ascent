"use client";

// The adoption curve: what share of contributors carry at least t% AI-attributed work.
//
// Replaces the segmented bar and the sentence above it ("Every contributor, by how much of their own
// recent work is AI-attributed"). Three MEASURED points, a hatched `not-judged` envelope where the
// producer buckets rather than observes, and — the part the bar could not say — nothing at all drawn
// through the interior, because we did not look there. Dependency-free SVG on the shared kit; every
// paint comes from `stateFill`/`stateStroke` or a design token, never a hand-picked hex.
//
// Layout follows MatrixGrid's Ledger: the plot SVG has NO viewBox and draws only marks, in percentage
// coordinates, so strokes, the hatch and the r=4 points never distort. Every glyph — the share axis,
// the threshold labels, the counts — is HTML in the semantic `type-*` scale, positioned by percentage
// against the same box, so type reads at its designed size however wide the panel is. A mark at the
// axis origin sets its label in the gutter, so it can never collide with the ≥1% label beside it.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { DEFAULT_BASE, HATCH_ID, VizDefs, r2, stateFill, stateStroke, stateTitle } from "@/components/org/viz";
import { curveSummary, type AdoptionCurveModel, type CurveMark } from "./adoptionCurveModel";

const Y_TICKS = [0, 50, 100];

/** A percentage of the plot box — an x position, a width or a height. */
const P = (v: number) => `${r2(v)}%`;
/** A share (0..100) as a y position: 100% share sits at the top of the box. */
const Y = (share: number) => P(100 - share);

/** Near the origin a label anchors start (it would otherwise run into the gutter); at the far edge, end. */
function anchor(threshold: number): string {
  if (threshold < 25) return "translate-x-0 items-start";
  if (threshold >= 100) return "-translate-x-full items-end";
  return "-translate-x-1/2 items-center";
}

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
  const fade = (i: number) => ({
    opacity: animate ? 1 : 0,
    transition: reduced ? undefined : `opacity 0.4s ease-out ${Math.min(i * 90, 360)}ms`,
  });
  const markTitle = (k: CurveMark) => `${k.count} of ${model.total} contributors at ${k.label} — ${Math.round(k.share)}% of the population.`;
  const markLabel = (k: CurveMark, i: number, cls: string, left?: string) => (
    <div key={k.threshold} data-mark-label={k.threshold} title={markTitle(k)} className={`flex flex-col ${cls}`} style={{ ...fade(i), left }}>
      <span className="type-label whitespace-nowrap tracking-[0.1em] text-slate-500">{k.label}</span>
      <span className="type-mono-sm font-mono tabular-nums text-slate-300">{k.count}</span>
    </div>
  );

  return (
    <div className={className}>
      <div role="img" aria-label={label} className="grid pt-2" style={{ gridTemplateColumns: "auto minmax(0, 1fr)" }}>
        {/* the share axis: HTML labels at the percentage height of their grid line */}
        <div aria-hidden className="relative min-w-10">
          {Y_TICKS.map((t) => (
            <span
              key={t}
              className="absolute right-2 -translate-y-1/2 font-mono type-micro tabular-nums text-slate-500"
              style={{ top: Y(t) }}
            >
              {t}
            </span>
          ))}
        </div>

        <div className="relative h-28">
          <svg className="absolute inset-0 h-full w-full overflow-visible" focusable="false">
            <title>{label}</title>
            <VizDefs />

            {Y_TICKS.map((t) => (
              <line key={t} x1={0} y1={Y(t)} x2="100%" y2={Y(t)} stroke="var(--color-divider)" strokeWidth={1} strokeOpacity={t === 0 ? 1 : 0.35} />
            ))}

            {/* The unobserved interior. Hatched, bounded, and carrying no numeral — the curve provably
                lies inside each band, and drawing a line through it would assert a shape we never read. */}
            {model.gaps.map((g) => (
              <rect
                key={`${g.from}-${g.to}`}
                data-gap={`${g.from}-${g.to}`}
                x={P(g.from)}
                y={Y(g.hi)}
                width={P(g.to - g.from)}
                height={P(g.hi - g.lo)}
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
                  x1={P(model.orgShare)}
                  y1={0}
                  x2={P(model.orgShare)}
                  y2="100%"
                  stroke={DEFAULT_BASE}
                  strokeWidth={1}
                  strokeOpacity={0.45}
                />
                <title>{`Org commit-weighted AI share: ${Math.round(model.orgShare)}% — the fleet's single figure, plotted on the same threshold axis.`}</title>
              </g>
            )}

            {model.marks.map((k, i) => (
              <g key={k.threshold} data-mark={k.threshold} style={fade(i)}>
                <line x1={P(k.threshold)} y1={Y(k.share)} x2={P(k.threshold)} y2="100%" stroke={DEFAULT_BASE} strokeWidth={1} strokeOpacity={0.3} />
                <circle
                  cx={P(k.threshold)}
                  cy={Y(k.share)}
                  r={4}
                  fill={stateFill("measured", DEFAULT_BASE)}
                  stroke={stateStroke("measured", DEFAULT_BASE)}
                  strokeWidth={1}
                />
                <title>{markTitle(k)}</title>
              </g>
            ))}
          </svg>
        </div>

        {/* the threshold axis: a mark at the origin sits in the gutter, right-aligned to it */}
        <div aria-hidden className="flex flex-col items-end pt-2 pr-2">
          {model.marks.map((k, i) => (k.threshold <= 0 ? markLabel(k, i, "items-end") : null))}
        </div>
        <div aria-hidden className="relative mt-2 h-10">
          {model.marks.map((k, i) => (k.threshold <= 0 ? null : markLabel(k, i, `absolute top-0 ${anchor(k.threshold)}`, P(k.threshold))))}
        </div>
      </div>

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
