"use client";

// The graphical headline over the per-repository PR table: review coverage across the fleet, one
// column per repo, ordered worst-first, with the below-target tail bracketed.
//
// WHY THIS EXISTS. The table below arrives riskiest-first and said so in a sentence — "Riskiest
// first: lowest review coverage, then slowest merges." An ordering the reader is TOLD about is an
// ordering they have to take on trust while they read twelve rows of numbers; an ordering they can
// SEE is a shape. The ramp is the ordering, the bracket is the tail, and the count on the bracket is
// the headline reading the sentence was standing in for (§2.2).
//
// A repo whose scan never persisted a review-coverage denominator is a `missing` column: a dashed
// void the height of the plot with no fill and no numeral. It is NOT a zero-height bar, which is the
// exact misreading the kit's void state exists to make unavailable.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { scoreHex } from "@/lib/ui";
import {
  KICKER_SVG_CLASS,
  Legend,
  STATE_LABEL,
  VOID_DASH,
  isNum,
  r2,
  stateTitle,
} from "@/components/org/viz";

const W = 320;
const H = 78;
const PAD_TOP = 10;
const BASE_Y = 58;
const PLOT_H = BASE_Y - PAD_TOP;

export type CoverageRepo = { name: string; rate: number | null };

/** Worst measured coverage first, then the repos with no measurement — voids never rank as zero. */
export function orderByRisk(rows: CoverageRepo[]): CoverageRepo[] {
  const measured = rows.filter((r) => isNum(r.rate)).sort((a, b) => (a.rate as number) - (b.rate as number));
  return [...measured, ...rows.filter((r) => !isNum(r.rate))];
}

export function ReviewCoverageStrip({
  rows,
  target,
  className = "",
}: {
  rows: CoverageRepo[];
  /** The review-coverage bar the fleet is held to; drawn as the reference rule. */
  target: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  const ordered = orderByRisk(rows);
  if (ordered.length === 0) {
    return (
      <div role="img" aria-label="Review coverage: no repositories" className={`type-body-sm text-slate-500 ${className}`}>
        No repositories
      </div>
    );
  }

  const slot = W / ordered.length;
  const barW = Math.max(1, Math.min(18, slot - 1.5));
  const xOf = (i: number) => r2(i * slot + (slot - barW) / 2);
  const yOf = (v: number) => r2(BASE_Y - (Math.max(0, Math.min(100, v)) / 100) * PLOT_H);

  const below = ordered.filter((r) => isNum(r.rate) && (r.rate as number) < target).length;
  const voids = ordered.filter((r) => !isNum(r.rate)).length;
  const measured = ordered.length - voids;

  const ariaLabel =
    `Review coverage by repository, worst first: ${measured} measured of ${ordered.length}` +
    (below > 0 ? `, ${below} below the ${target}% target` : `, none below the ${target}% target`) +
    (voids > 0 ? `, ${voids} with no measurement drawn as empty columns rather than zeroes` : "") +
    ".";

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>

        {/* baseline + the target rule the tail falls short of */}
        <line x1={0} x2={W} y1={BASE_Y} y2={BASE_Y} stroke="var(--color-divider)" strokeWidth={1} />
        <line x1={0} x2={W} y1={yOf(target)} y2={yOf(target)} stroke="var(--color-accent)" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="3 3" />
        <text x={W - 1} y={yOf(target) - 3} textAnchor="end" fontSize={9} className={KICKER_SVG_CLASS}>
          {`target ${target}%`}
        </text>

        <g style={{ opacity: animate ? 1 : 0, transition: reduced ? undefined : "opacity 0.6s ease-out" }}>
          {ordered.map((r, i) =>
            isNum(r.rate) ? (
              <rect
                key={r.name}
                data-repo={r.name}
                data-state="measured"
                x={xOf(i)}
                y={yOf(r.rate)}
                width={barW}
                height={Math.max(1, r2(BASE_Y - yOf(r.rate)))}
                rx={1.5}
                fill={scoreHex(r.rate)}
                fillOpacity={0.85}
              >
                <title>{`${r.name}: ${r.rate}% review coverage${r.rate < target ? ` — below the ${target}% target` : ""}`}</title>
              </rect>
            ) : (
              <rect
                key={r.name}
                data-repo={r.name}
                data-state="missing"
                x={xOf(i)}
                y={PAD_TOP}
                width={barW}
                height={PLOT_H}
                rx={1.5}
                fill="none"
                stroke="var(--color-divider)"
                strokeWidth={1}
                strokeDasharray={VOID_DASH}
              >
                <title>{stateTitle("missing", `${r.name} review coverage`)}</title>
              </rect>
            ),
          )}
        </g>

        {/* the risky tail, bracketed — the ordering made visible instead of stated */}
        {below > 0 && (
          <g data-tail={below}>
            <path
              d={`M 0 ${BASE_Y + 5} L 0 ${BASE_Y + 9} L ${r2(below * slot)} ${BASE_Y + 9} L ${r2(below * slot)} ${BASE_Y + 5}`}
              fill="none"
              stroke="var(--color-warn)"
              strokeWidth={1.5}
            />
            <text x={2} y={H - 3} fontSize={9} className={KICKER_SVG_CLASS}>
              {`${below} below target`}
            </text>
          </g>
        )}
      </svg>

      <Legend className="mt-2" states={voids > 0 ? ["measured", "missing"] : ["measured"]} />

      <table className="sr-only">
        <caption>Review coverage by repository, worst first</caption>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Review coverage</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => (
            <tr key={r.name}>
              <th scope="row">{r.name}</th>
              <td>{isNum(r.rate) ? `${r.rate}%` : STATE_LABEL.missing}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
