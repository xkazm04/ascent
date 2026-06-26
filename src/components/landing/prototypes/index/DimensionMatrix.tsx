"use client";

// Dimensions section for The Index — a bar-gauge matrix of the 9 dimensions × the 3 archetype lenses,
// each cell a horizontal bar of the REAL archetype weight (normalized to the heaviest cell) plus its
// percentage. Editorial chrome (hairline rules, no HUD brackets).

import { motion } from "framer-motion";
import { DIMENSIONS } from "@/lib/maturity/model";
import { SectionHeading } from "@/components/ui";
import { usePrefersReducedMotion } from "@/components/report/chartMotion";
import { ARCHETYPE_COLUMNS, AXIS_LABEL, TRACK_MAX, buildMatrixRows, pct } from "../shared/matrixData";

const ROWS = buildMatrixRows();

function CellBar({ w }: { w: number }) {
  // LAND #1: the page-wide reducedMotion="user" doesn't degrade direct `width` animation (a non-
  // transform value), so gate it explicitly like the sibling ScoreGauge/TrajectoryChart — reduced
  // motion renders the bar at its final width with no sweep.
  const reduced = usePrefersReducedMotion();
  // Scale against a FIXED 0..TRACK_MAX track (not the heaviest cell) so the bar length is proportional
  // to the absolute percent printed beside it — the heaviest weight no longer renders a full-track bar
  // captioned with a sub-100% number.
  const frac = TRACK_MAX > 0 ? Math.min(1, w / TRACK_MAX) : 0;
  const target = `${(frac * 100).toFixed(0)}%`;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
        <motion.span
          className="absolute inset-y-0 left-0 block rounded-full bg-accent"
          initial={reduced ? false : { width: 0 }}
          animate={reduced ? { width: target } : undefined}
          whileInView={reduced ? undefined : { width: target }}
          viewport={{ once: false, margin: "-8% 0px" }}
          transition={reduced ? { duration: 0 } : { duration: 0.7, ease: "easeOut" }}
        />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-xs font-bold tabular-nums text-slate-300">{pct(w)}</span>
    </div>
  );
}

export function DimensionMatrix() {
  return (
    <section id="dimensions" className="flex min-h-screen snap-start flex-col justify-start pb-10 pt-14 lg:justify-center">
      <SectionHeading
        size="page"
        kicker="The instrument"
        title={`${DIMENSIONS.length} dimensions, three profiles`}
        intro={`The same ${DIMENSIONS.length} signals, re-weighted for a solo project, a team, or a whole org. Longer bars carry more weight in that profile.`}
      />

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left">
          <caption className="sr-only">Per-dimension weighting across the Solo, Team, and Org archetype lenses.</caption>
          <thead>
            <tr className="border-b border-slate-700">
              <th scope="col" className="pb-3 pr-4 font-mono text-xs uppercase tracking-widest text-slate-500">Dimension</th>
              {ARCHETYPE_COLUMNS.map((c) => (
                <th key={c.key} scope="col" className="px-3 pb-3 font-mono text-xs uppercase tracking-widest text-slate-400">
                  {c.label} <span className="text-slate-600">· {c.sub}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.id} className="border-b border-slate-800/70 last:border-0">
                <th scope="row" className="py-3.5 pr-4 align-middle">
                  <span className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.axis === "adoption" ? "bg-accent" : "bg-slate-500"}`} title={AXIS_LABEL[r.axis]} />
                    <span className="font-mono text-xs text-slate-600">{r.id}</span>
                    <span className="text-sm font-semibold text-white">{r.name}</span>
                  </span>
                </th>
                {ARCHETYPE_COLUMNS.map((c) => (
                  <td key={c.key} className="px-3 py-3.5 align-middle" title={r.description}>
                    <CellBar w={r[c.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs uppercase tracking-widest text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Adoption axis</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-slate-500" /> Rigor axis</span>
      </div>
    </section>
  );
}
