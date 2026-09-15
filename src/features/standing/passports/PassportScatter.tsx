"use client";

// Automation × Production scatter (P3) — the headline portfolio view the design calls the whole payoff:
// each repo is a point (x = automation readiness, y = production readiness), so the "automatable but not
// production-ready" quadrant (and its opposite) jumps out. Interactive: each quadrant is a click target
// that filters the portfolio to its cohort (click again to clear), a point click focuses that repo's row
// in the table, and points outside the active cohort fade. Colored by production band, with a legend so
// the palette is self-explanatory. Quadrant split at 65 (the production/L4 cutoff).
//
// /org redesign: this was the tab's ONE svg and it spoke its own dialect — three hand-picked hexes for
// its rules, and a bespoke dashed-hollow ring for a placeholder scan. It now paints on the shared kit:
// a placeholder point is the kit's `not-judged` HATCH over the one `<VizDefs/>` pattern, the rules are
// `--color-divider`, and the legend is the kit `Legend` carrying the real marks. A repo whose scan was
// never graded therefore reads the same here, in the Clearance ladder and in the Doctor-check grid.

import {
  BAND_COLOR,
  BAND_LABEL,
  COHORT_META,
  PASSPORT_SPLIT,
  bandColor,
  type PassportCohort,
} from "@/lib/org/passport-display";
import { Legend, VizDefs, stateFill, stateStroke, stateTitle, type LegendExtra } from "@/components/org/viz";
import { PLACEHOLDER_LABEL } from "@/features/standing/passports/PlaceholderMark";

export interface ScatterPoint {
  name: string;
  x: number; // automation score 0..100
  y: number; // production score 0..100
  band: string;
  /** Outside the active cohort filter — rendered faded so the filtered set pops. */
  faded?: boolean;
  /** Scored by the deterministic MOCK engine — a placeholder floor, not a graded scan. Drawn hollow
   *  with a dashed ring so it is still IN the plot (never excluded), just visibly not measured. */
  placeholder?: boolean;
}

const W = 440;
const H = 340;
const PAD = 40;

const px = (v: number) => PAD + (Math.max(0, Math.min(100, v)) / 100) * (W - 2 * PAD);
const py = (v: number) => H - PAD - (Math.max(0, Math.min(100, v)) / 100) * (H - 2 * PAD);

/** The production bands as `Legend` rows carrying the plot's own dot. Bands are a domain palette, not
 *  one of the six epistemic states, so they ride as `extra` rather than being forced into the kit's
 *  vocabulary — which is exactly what `LegendExtra` exists for. */
const BAND_LEGEND: LegendExtra[] = (Object.keys(BAND_LABEL) as (keyof typeof BAND_LABEL)[]).map((b) => ({
  id: b,
  label: BAND_LABEL[b],
  swatch: <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: BAND_COLOR[b] }} />,
}));

export function PassportScatter({
  points,
  active = null,
  onCohort,
  onPoint,
}: {
  points: ScatterPoint[];
  /** The active cohort filter — its quadrant is highlighted (null / "no-obs" highlight nothing). */
  active?: PassportCohort | "no-obs" | null;
  /** Quadrant clicked — the parent toggles the cohort filter. */
  onCohort?: (cohort: PassportCohort) => void;
  /** Point clicked — the parent focuses that repo's table row. */
  onPoint?: (name: string) => void;
}) {
  const splitX = px(PASSPORT_SPLIT);
  const splitY = py(PASSPORT_SPLIT);
  const notJudged = points.filter((p) => p.placeholder).length;
  const ariaLabel =
    `Automation readiness versus production readiness, one point per repository across ${points.length} ` +
    `${points.length === 1 ? "repo" : "repos"}. Click a quadrant to filter the table to its cohort.` +
    (notJudged > 0 ? ` ${notJudged} of them carry a placeholder scan and are drawn hatched: never graded by a model, not a low score.` : "");

  // Quadrant geometry + resting fill (ready/gap keep their faint tint; the left quadrants are bare).
  const quads: { id: PassportCohort; x: number; y: number; w: number; h: number; restOpacity: number }[] = [
    { id: "ready", x: splitX, y: PAD, w: W - PAD - splitX, h: splitY - PAD, restOpacity: 0.06 },
    { id: "gap", x: splitX, y: splitY, w: W - PAD - splitX, h: H - PAD - splitY, restOpacity: 0.06 },
    { id: "hostile", x: PAD, y: PAD, w: splitX - PAD, h: splitY - PAD, restOpacity: 0 },
    { id: "early", x: PAD, y: splitY, w: splitX - PAD, h: H - PAD - splitY, restOpacity: 0 },
  ];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <VizDefs />
        {/* quadrant click targets (also the faint cohort fills) */}
        {quads.map((q) => (
          <rect
            key={q.id}
            x={q.x}
            y={q.y}
            width={q.w}
            height={q.h}
            fill={COHORT_META[q.id].color}
            fillOpacity={active === q.id ? 0.14 : q.restOpacity}
            className="focus-ring cursor-pointer transition-[fill-opacity] duration-300 motion-reduce:transition-none"
            role="button"
            tabIndex={0}
            aria-pressed={active === q.id}
            aria-label={`${COHORT_META[q.id].label}: filter portfolio to this cohort`}
            onClick={() => onCohort?.(q.id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onCohort?.(q.id))}
          >
            <title>{`${COHORT_META[q.id].label}, click to filter`}</title>
          </rect>
        ))}
        {/* axes + quadrant split lines — the one hairline token, never a hand-picked hex (BRAND.md) */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--color-divider)" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--color-divider)" />
        <line x1={splitX} y1={PAD} x2={splitX} y2={H - PAD} stroke="var(--color-divider)" strokeDasharray="3 3" strokeOpacity={0.7} />
        <line x1={PAD} y1={splitY} x2={W - PAD} y2={splitY} stroke="var(--color-divider)" strokeDasharray="3 3" strokeOpacity={0.7} />
        {/* axis labels */}
        <text x={W / 2} y={H - 8} textAnchor="middle" className="fill-slate-500" fontSize="11" fontFamily="monospace">Automation readiness →</text>
        <text x={12} y={H / 2} textAnchor="middle" fontSize="11" fontFamily="monospace" className="fill-slate-500" transform={`rotate(-90 12 ${H / 2})`}>Production readiness →</text>
        {/* quadrant captions */}
        <text x={W - PAD - 4} y={PAD + 12} textAnchor="end" fontSize="9" fontFamily="monospace" className="pointer-events-none fill-emerald-500/70">ready to ship</text>
        <text x={W - PAD - 4} y={H - PAD - 6} textAnchor="end" fontSize="9" fontFamily="monospace" className="pointer-events-none fill-orange-400/70">automatable, not prod-ready</text>
        <text x={PAD + 4} y={PAD + 12} textAnchor="start" fontSize="9" fontFamily="monospace" className="pointer-events-none fill-slate-500">prod-grade, agent-hostile</text>
        <text x={PAD + 4} y={H - PAD - 6} textAnchor="start" fontSize="9" fontFamily="monospace" className="pointer-events-none fill-slate-600">early</text>
        {/* points — stable order + stable keys so the opacity transition survives filter changes
            (re-sorting for z-order would re-key/move nodes and cut the animation; at 0.18 opacity a
            faded point barely occludes anyway) */}
        {points.map((p) => (
          <circle
            key={p.name}
            data-state={p.placeholder ? "not-judged" : "measured"}
            cx={px(p.x)}
            cy={py(p.y)}
            r={5}
            fill={p.placeholder ? stateFill("not-judged") : bandColor(p.band)}
            fillOpacity={p.placeholder ? 1 : 0.85}
            opacity={p.faded ? 0.18 : 1}
            stroke={p.placeholder ? stateStroke("not-judged") : "var(--color-ink)"}
            strokeWidth={p.placeholder ? 1.25 : 0.75}
            className={`transition-opacity duration-300 motion-reduce:transition-none${onPoint && !p.faded ? " cursor-pointer" : ""}`}
            onClick={onPoint && !p.faded ? () => onPoint(p.name) : undefined}
          >
            <title>
              {p.placeholder
                ? `${stateTitle("not-judged", p.name)} Automation ${p.x}, production ${p.y} (${p.band}) from a ${PLACEHOLDER_LABEL}.`
                : `${p.name}: automation ${p.x}, production ${p.y} (${p.band})${onPoint && !p.faded ? " · click to open in table" : ""}`}
            </title>
          </circle>
        ))}
      </svg>
      {/* The point palette, spelled out with the REAL marks — one kit `Legend`, not a second dialect.
          The `not-judged` row appears only when the plot actually contains one: a legend explains the
          marks on screen, it does not teach a vocabulary for a state this fleet is not in. */}
      <Legend
        className="mt-2"
        states={points.some((p) => p.placeholder) ? ["not-judged"] : []}
        extra={BAND_LEGEND}
      />
    </div>
  );
}
