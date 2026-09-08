"use client";

// The graphical headline over the branch-governance table: which guardrail each at-risk repo is
// missing, as a grid of marks rather than a page of ✓ and — glyphs.
//
// WHY NOT `MatrixGrid`. The kit's matrix paints a cell from a 0–100 SCORE and prints that numeral.
// These four controls are BOOLEAN — a repo either requires status checks or it does not — so a score
// cell would have to print "100" or "0" per control, inventing a percentage for a yes/no fact. The
// state vocabulary itself is imported unchanged (`stateFill`/`stateStroke`/`stateDash`/`stateTitle`,
// §2.4); only the geometry is local, which is exactly the split the law asks for.
//
// The mapping, and the one thing this drawing can say that a tick column could not:
//   ON  — observed enforcing            → `measured`, painted at scoreHex(100)
//   OFF — observed absent               → `measured`, painted at scoreHex(0). A real, measured zero.
//   PR required with ZERO approvals     → `declared` — a dashed outline, no fill. The rule exists on
//                                         paper and gates nothing: authors can self-merge. That is
//                                         "declared, not enforced", and it used to be a tooltip.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { scoreHex } from "@/lib/ui";
import {
  KICKER_SVG_CLASS,
  Legend,
  STATE_LABEL,
  r2,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
  type VizState,
} from "@/components/org/viz";

const LABEL_W = 116;
const CELL_W = 52;
const CELL_H = 22;
const HEADER_H = 16;

export const GOVERNANCE_AXES = ["Protected", "Reviews", "Checks", "Signed"] as const;

export type GapCell = { state: VizState; on: boolean };
export type GapRow = { id: string; label: string; cells: GapCell[] };

const ON = () => scoreHex(100);
const OFF = () => scoreHex(0);

export function GovernanceGapMatrix({ rows, className = "" }: { rows: GapRow[]; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  if (rows.length === 0) {
    return (
      <div role="img" aria-label="Branch governance: no repository is missing a guardrail" className={`type-body-sm text-slate-500 ${className}`}>
        No repository is missing a guardrail
      </div>
    );
  }

  const axes = GOVERNANCE_AXES;
  const W = LABEL_W + axes.length * CELL_W;
  const H = HEADER_H + rows.length * CELL_H;
  const anyDeclared = rows.some((r) => r.cells.some((c) => c.state === "declared"));

  const ariaLabel =
    `Branch-governance gaps, riskiest first. ` +
    rows
      .map(
        (r) =>
          `${r.label}: ` +
          axes
            .map((a, i) => {
              const c = r.cells[i];
              if (!c) return `${a} no measurement`;
              return c.state === "declared" ? `${a} declared but not enforced` : `${a} ${c.on ? "on" : "off"}`;
            })
            .join(", "),
      )
      .join("; ") +
    ". A dashed cell is a rule that exists but gates nothing.";

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>

        {axes.map((a, i) => (
          <text key={a} x={LABEL_W + i * CELL_W + CELL_W / 2} y={HEADER_H - 5} textAnchor="middle" fontSize={9} className={KICKER_SVG_CLASS}>
            {a}
          </text>
        ))}
        <line x1={0} y1={r2(HEADER_H - 2)} x2={W} y2={r2(HEADER_H - 2)} stroke="var(--color-divider)" strokeWidth={1} />

        {rows.map((row, ri) => {
          const y = HEADER_H + ri * CELL_H;
          return (
            <g
              key={row.id}
              style={{
                opacity: animate ? 1 : 0,
                transition: reduced ? undefined : `opacity 0.4s ease-out ${Math.min(ri * 45, 360)}ms`,
              }}
            >
              <text x={0} y={y + CELL_H / 2 + 3} fontSize={10} className={KICKER_SVG_CLASS}>
                {row.label}
              </text>
              {axes.map((a, ci) => {
                const cell = row.cells[ci] ?? { state: "missing" as VizState, on: false };
                const x = LABEL_W + ci * CELL_W;
                const base = cell.state === "declared" ? OFF() : cell.on ? ON() : OFF();
                return (
                  <g key={`${row.id}-${a}`} data-cell={`${row.id}:${a}`} data-state={cell.state}>
                    <rect x={x + 3} y={y + 3} width={CELL_W - 6} height={CELL_H - 6} rx={3} fill="none" stroke="var(--color-divider)" strokeWidth={1} strokeOpacity={0.5} />
                    {cell.state !== "missing" && (
                      <rect
                        data-mark
                        x={x + 3}
                        y={y + 3}
                        width={CELL_W - 6}
                        height={CELL_H - 6}
                        rx={3}
                        fill={stateFill(cell.state, base)}
                        fillOpacity={stateFillOpacity(cell.state) * 0.55}
                        stroke={stateStroke(cell.state, base)}
                        strokeWidth={stateStrokeWidth(cell.state)}
                        strokeDasharray={stateDash(cell.state)}
                      />
                    )}
                    <title>
                      {cell.state === "declared"
                        ? stateTitle("declared", `${row.label} · ${a}`)
                        : `${row.label} · ${a}: ${cell.on ? "on" : "off"} — observed at the last scan.`}
                    </title>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      <Legend className="mt-2" states={anyDeclared ? ["measured", "declared"] : ["measured"]} />

      <table className="sr-only">
        <caption>Branch-governance gaps by repository, riskiest first</caption>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            {axes.map((a) => (
              <th key={a} scope="col">
                {a}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              {axes.map((a, i) => {
                const c = row.cells[i];
                return <td key={a}>{!c ? STATE_LABEL.missing : c.state === "declared" ? STATE_LABEL.declared : c.on ? "On" : "Off"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
