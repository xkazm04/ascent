"use client";

// THE ACCRETION, DRAWN. "Six notes about one incident are six recall-budget entries that together say
// one thing" was a sentence above a list of proposals; here it is the shape of the proposal itself:
// N member marks on the left, converging into ONE summary mark on the right.
//
// Two of the panel's load-bearing caveats become the paint rather than the prose:
//  · the members are `superseded` — 50% opacity plus a strikethrough rule — because applying
//    SUPERSEDES them, never deletes them; they stay in the store, pointing at the rollup.
//  · the summary is `declared` — dashed outline, no fill — until it is applied, because NOTHING IS
//    WRITTEN until a second, deliberate click. Once applied it becomes `decided`: an accent ring,
//    the vocabulary's mark for "a person decided this".
//
// Every encoding comes from the shared vocabulary (@/components/org/viz). Nothing here re-defines a
// dash, a hatch or an opacity.

import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import {
  KICKER_SVG_CLASS,
  SUPERSEDED_OPACITY,
  VizDefs,
  r2,
  stateDash,
  stateFill,
  stateFillOpacity,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
  type VizState,
} from "@/components/org/viz";

const W = 300;
const MEMBER_X = 4;
const MEMBER_W = 84;
const MEMBER_H = 12;
const MEMBER_GAP = 6;
const SUMMARY_X = 196;
const SUMMARY_W = 100;
const PAD = 10;
/** Rows past this fold into a "+N more" tick, so a 40-member family is still one readable diagram. */
const MAX_ROWS = 6;

export function MergeCluster({
  memberCount,
  memberLabels,
  applied = false,
  className = "",
}: {
  /** The TRUE member count — the diagram says so even when it can only draw MAX_ROWS of them. */
  memberCount: number;
  /** Short labels (kind names) for the rows actually drawn. */
  memberLabels: string[];
  applied?: boolean;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced;

  const rows = memberLabels.slice(0, MAX_ROWS);
  const hidden = Math.max(0, memberCount - rows.length);
  const bodyH = Math.max(1, rows.length) * (MEMBER_H + MEMBER_GAP) - MEMBER_GAP;
  const H = bodyH + PAD * 2 + (hidden > 0 ? 12 : 0);
  const summaryState: VizState = applied ? "decided" : "declared";
  const midY = PAD + bodyH / 2;

  const ariaLabel =
    `${memberCount} memor${memberCount === 1 ? "y" : "ies"} consolidating into one summary. ` +
    `The members are drawn superseded — applying supersedes them rather than deleting them. ` +
    (applied
      ? "The summary is drawn as decided: a person applied it."
      : "The summary is drawn declared, not written: nothing is stored until you apply the proposal.");

  const yOf = (i: number) => PAD + i * (MEMBER_H + MEMBER_GAP);

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <VizDefs />

        <g style={{ opacity: animate ? 1 : 0, transition: reduced ? undefined : "opacity 0.5s ease-out" }}>
          {/* the convergence — one hairline per member into the summary's midpoint */}
          {rows.map((label, i) => {
            const y = yOf(i) + MEMBER_H / 2;
            return (
              <path
                key={`edge-${label}-${i}`}
                data-edge={i}
                d={`M ${MEMBER_X + MEMBER_W} ${r2(y)} C ${MEMBER_X + MEMBER_W + 40} ${r2(y)}, ${SUMMARY_X - 40} ${r2(midY)}, ${SUMMARY_X} ${r2(midY)}`}
                fill="none"
                stroke="var(--color-divider)"
                strokeWidth={1}
                strokeOpacity={SUPERSEDED_OPACITY}
              />
            );
          })}

          {/* the members: superseded — dimmed, and struck through */}
          {rows.map((label, i) => {
            const y = yOf(i);
            return (
              <g key={`m-${label}-${i}`} data-member={i} data-state="superseded" opacity={SUPERSEDED_OPACITY}>
                <rect
                  x={MEMBER_X}
                  y={y}
                  width={MEMBER_W}
                  height={MEMBER_H}
                  rx={2}
                  fill={stateFill("superseded")}
                  fillOpacity={stateFillOpacity("superseded") * 0.5}
                  stroke={stateStroke("superseded")}
                  strokeWidth={stateStrokeWidth("superseded")}
                >
                  <title>{stateTitle("superseded", label)}</title>
                </rect>
                <line
                  data-strike={i}
                  x1={MEMBER_X + 3}
                  y1={r2(y + MEMBER_H / 2)}
                  x2={MEMBER_X + MEMBER_W - 3}
                  y2={r2(y + MEMBER_H / 2)}
                  stroke="var(--color-divider)"
                  strokeWidth={1.5}
                />
              </g>
            );
          })}

          {hidden > 0 && (
            <text x={MEMBER_X} y={PAD + bodyH + 11} fontSize={9} className={KICKER_SVG_CLASS}>
              {`+${hidden} more`}
            </text>
          )}

          {/* the summary: declared until applied, decided once a person applies it */}
          <rect
            data-summary
            data-state={summaryState}
            x={SUMMARY_X}
            y={r2(midY - MEMBER_H)}
            width={SUMMARY_W}
            height={MEMBER_H * 2}
            rx={3}
            fill={stateFill(summaryState)}
            fillOpacity={stateFillOpacity(summaryState) * 0.4}
            stroke={stateStroke(summaryState)}
            strokeWidth={stateStrokeWidth(summaryState)}
            strokeDasharray={stateDash(summaryState)}
          >
            <title>{stateTitle(summaryState, "The proposed summary")}</title>
          </rect>
          <text x={SUMMARY_X + SUMMARY_W / 2} y={r2(midY + 4)} textAnchor="middle" fontSize={9} className={KICKER_SVG_CLASS}>
            {applied ? "written" : "proposed"}
          </text>
        </g>
      </svg>

      <table className="sr-only">
        <caption>Consolidation — members and the summary that would replace them</caption>
        <thead>
          <tr>
            <th scope="col">Mark</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{`${memberCount} member memories`}</th>
            <td>{stateTitle("superseded")}</td>
          </tr>
          <tr>
            <th scope="row">Summary</th>
            <td>{stateTitle(summaryState)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
