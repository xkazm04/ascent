"use client";

// A subject's blast radius, DRAWN. One bar per mapped repo, length = the contexts of that repo the
// subject governs, painted with the repo's verdict state from the kit's vocabulary.
//
// Impact is a magnitude, so it is a length. The paint is the second axis: a solid bar is a verdict
// somebody wrote, a hatched one is a pairing nobody has judged, a dashed outline is a boundary the
// repo's manifest declared. A repo that subscribes no context draws the empty frame — a MEASURED
// zero, which is a different fact from the whole reading being unavailable (that case never reaches
// this component; `KnowledgeSubjectImpact` renders a void instead).
//
// Dependency-free SVG on `linScale`; every fill, stroke, dash and hatch comes from
// `@/components/org/viz`. Entrance only, and skipped under `prefers-reduced-motion`.

import { linScale } from "@/components/report/chartScale";
import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { r2 } from "@/components/org/viz";
import {
  KICKER_SVG_CLASS,
  STATE_LABEL,
  VizDefs,
  isStruck,
  isVoid,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
} from "@/components/org/viz";
import { STATE_LABEL as CELL_LABEL } from "./knowledgeModel";
import type { ImpactRow } from "./knowledgeViz";

const LABEL_W = 118;
const ROW_H = 16;
const BAR_H = 9;
const W = 300;

/** Repo name shortened to the owner-less tail; the gutter is 118 units at 9px. */
const shortName = (full: string) => {
  const tail = full.split("/").pop() ?? full;
  return tail.length <= 18 ? tail : `${tail.slice(0, 17).trimEnd()}…`;
};

export function KnowledgeImpactBars({ rows, subject }: { rows: ImpactRow[]; subject: string }) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;
  if (rows.length === 0) return null;

  const max = Math.max(1, ...rows.map((r) => r.contexts));
  const x = linScale(max, LABEL_W, W - LABEL_W - 26);
  const H = rows.length * ROW_H + 2;
  const label = `Contexts governed by ${subject}, per mapped repository. ${rows
    .map((r) => `${r.repo.fullName}: ${r.contexts} ${r.contexts === 1 ? "context" : "contexts"}, ${CELL_LABEL[r.cellState].toLowerCase()}`)
    .join("; ")}. An empty bar is a repository with no context subscribed — a measurement, not an absence.`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        <title>{label}</title>
        <VizDefs />
        {rows.map((r, i) => {
          const y = i * ROW_H + 2;
          const cy = y + BAR_H / 2;
          const end = r2(x(r.contexts));
          return (
            <g
              key={r.repo.repositoryId}
              data-impact={r.repo.repositoryId}
              data-state={r.state}
              opacity={animate ? 1 : 0}
              style={{ transition: reduced ? undefined : `opacity 0.35s ease-out ${Math.min(i * 40, 320)}ms` }}
            >
              <text x={0} y={y + BAR_H} fontSize={9} className={KICKER_SVG_CLASS}>
                {shortName(r.repo.fullName)}
              </text>
              {/* The track — always drawn, so a repo with no subscribed context is a locatable empty
                  frame rather than a missing row. */}
              <rect x={LABEL_W} y={y} width={W - LABEL_W - 26} height={BAR_H} rx={2} fill="none" stroke="var(--color-divider)" strokeWidth={1} strokeOpacity={0.4} />
              {!isVoid(r.state) && r.contexts > 0 && (
                <rect
                  data-mark
                  x={LABEL_W}
                  y={y}
                  width={Math.max(2, end - LABEL_W)}
                  height={BAR_H}
                  rx={2}
                  fill={stateFill(r.state)}
                  fillOpacity={stateFillOpacity(r.state) * 0.55}
                  stroke={stateStroke(r.state)}
                  strokeWidth={stateStrokeWidth(r.state)}
                  strokeDasharray={stateDash(r.state)}
                />
              )}
              {isStruck(r.state) && <line x1={LABEL_W} y1={cy} x2={end} y2={cy} stroke="var(--color-divider)" strokeWidth={1} />}
              <text x={W - 22} y={y + BAR_H} fontSize={9} className="fill-slate-400 font-mono tabular-nums">
                {r.contexts}
              </text>
              <title>{`${r.repo.fullName} — ${CELL_LABEL[r.cellState]} · ${r.contexts} context${r.contexts === 1 ? "" : "s"}${
                r.stale ? `, ${r.stale} stale` : ""
              }. ${stateTitle(r.state)}`}</title>
            </g>
          );
        })}
      </svg>

      <table className="sr-only">
        <caption>{`Contexts governed by ${subject}, per mapped repository`}</caption>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Contexts</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.repo.repositoryId}>
              <th scope="row">{r.repo.fullName}</th>
              <td>{r.contexts}</td>
              <td>{`${CELL_LABEL[r.cellState]} — ${STATE_LABEL[r.state]}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
