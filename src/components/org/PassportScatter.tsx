"use client";

// Automation × Production scatter (P3) — the headline portfolio view the design calls the whole payoff:
// each repo is a point (x = automation readiness, y = production readiness), so the "automatable but not
// production-ready" quadrant (and its opposite) jumps out. Interactive: each quadrant is a click target
// that filters the portfolio to its cohort (click again to clear), a point click focuses that repo's row
// in the table, and points outside the active cohort fade. Colored by production band, with a legend so
// the palette is self-explanatory. Quadrant split at 65 (the production/L4 cutoff).

import {
  BAND_COLOR,
  BAND_LABEL,
  COHORT_META,
  PASSPORT_SPLIT,
  bandColor,
  type PassportCohort,
} from "@/lib/org/passport-display";

export interface ScatterPoint {
  name: string;
  x: number; // automation score 0..100
  y: number; // production score 0..100
  band: string;
  /** Outside the active cohort filter — rendered faded so the filtered set pops. */
  faded?: boolean;
}

const W = 440;
const H = 340;
const PAD = 40;

const px = (v: number) => PAD + (Math.max(0, Math.min(100, v)) / 100) * (W - 2 * PAD);
const py = (v: number) => H - PAD - (Math.max(0, Math.min(100, v)) / 100) * (H - 2 * PAD);

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

  // Quadrant geometry + resting fill (ready/gap keep their faint tint; the left quadrants are bare).
  const quads: { id: PassportCohort; x: number; y: number; w: number; h: number; restOpacity: number }[] = [
    { id: "ready", x: splitX, y: PAD, w: W - PAD - splitX, h: splitY - PAD, restOpacity: 0.06 },
    { id: "gap", x: splitX, y: splitY, w: W - PAD - splitX, h: H - PAD - splitY, restOpacity: 0.06 },
    { id: "hostile", x: PAD, y: PAD, w: splitX - PAD, h: splitY - PAD, restOpacity: 0 },
    { id: "early", x: PAD, y: splitY, w: splitX - PAD, h: H - PAD - splitY, restOpacity: 0 },
  ];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Automation readiness versus production readiness, one point per repository. Click a quadrant to filter the table to its cohort.">
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
            className="cursor-pointer focus-ring"
            role="button"
            tabIndex={0}
            aria-pressed={active === q.id}
            aria-label={`${COHORT_META[q.id].label} — filter portfolio to this cohort`}
            onClick={() => onCohort?.(q.id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onCohort?.(q.id))}
          >
            <title>{`${COHORT_META[q.id].label} — click to filter`}</title>
          </rect>
        ))}
        {/* axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" />
        {/* quadrant split lines */}
        <line x1={splitX} y1={PAD} x2={splitX} y2={H - PAD} stroke="#1e293b" strokeDasharray="3 3" />
        <line x1={PAD} y1={splitY} x2={W - PAD} y2={splitY} stroke="#1e293b" strokeDasharray="3 3" />
        {/* axis labels */}
        <text x={W / 2} y={H - 8} textAnchor="middle" className="fill-slate-500" fontSize="11" fontFamily="monospace">Automation readiness →</text>
        <text x={12} y={H / 2} textAnchor="middle" fontSize="11" fontFamily="monospace" className="fill-slate-500" transform={`rotate(-90 12 ${H / 2})`}>Production readiness →</text>
        {/* quadrant captions */}
        <text x={W - PAD - 4} y={PAD + 12} textAnchor="end" fontSize="9" fontFamily="monospace" className="pointer-events-none fill-emerald-500/70">ready to ship</text>
        <text x={W - PAD - 4} y={H - PAD - 6} textAnchor="end" fontSize="9" fontFamily="monospace" className="pointer-events-none fill-orange-400/70">automatable, not prod-ready</text>
        <text x={PAD + 4} y={PAD + 12} textAnchor="start" fontSize="9" fontFamily="monospace" className="pointer-events-none fill-slate-500">prod-grade, agent-hostile</text>
        <text x={PAD + 4} y={H - PAD - 6} textAnchor="start" fontSize="9" fontFamily="monospace" className="pointer-events-none fill-slate-600">early</text>
        {/* points — faded ones first so the active cohort renders on top */}
        {[...points].sort((a, b) => Number(b.faded ?? false) - Number(a.faded ?? false)).map((p, i) => (
          <circle
            key={`${p.name}-${i}`}
            cx={px(p.x)}
            cy={py(p.y)}
            r={5}
            fill={bandColor(p.band)}
            fillOpacity={p.faded ? 0.15 : 0.85}
            stroke="#04070e"
            strokeWidth={0.75}
            className={onPoint && !p.faded ? "cursor-pointer" : undefined}
            onClick={onPoint && !p.faded ? () => onPoint(p.name) : undefined}
          >
            <title>{`${p.name} — automation ${p.x}, production ${p.y} (${p.band})${onPoint && !p.faded ? " · click to open in table" : ""}`}</title>
          </circle>
        ))}
      </svg>
      {/* band legend — the point palette, spelled out */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-500">
        {(Object.keys(BAND_LABEL) as (keyof typeof BAND_LABEL)[]).map((b) => (
          <span key={b} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: BAND_COLOR[b] }} />
            {BAND_LABEL[b]}
          </span>
        ))}
      </div>
    </div>
  );
}
