// The denominator behind the headline tiles, drawn as one strip of the org's repositories.
//
// Every delta on the tiles above is COHORT-MATCHED — measured only over repos scanned on BOTH sides
// of the week — so the number is unreadable without the size of that cohort beside it. That used to
// be a sentence ("measured over 8 repositories scanned on both sides of the week (+2 onboarded, 1
// departed) · 10/12 repositories scanned"), which asks a reader to hold three nested populations in
// their head. They are nested, so a strip shows them: the whole org, the part of it scanned, and the
// part of THAT which had a scan on both ends to compare.
//
// With no baseline at all the cohort is not zero — it does not exist. It draws as a void over the
// scanned span and prints no count, and the tiles above have already dropped their delta badges.
// Repos with no scan at all are `not-judged` (never assessed), not repos that scored nothing.

import { HATCH_ID, VOID_DASH, VizDefs, isNum, r2, stateTitle } from "@/components/org/viz";
import type { CoverageView } from "./digestViz";

const W = 300;
const H = 26;
const BAR_Y = 4;
const BAR_H = 11;

export function DigestCoverageStrip({ view }: { view: CoverageView }) {
  const { total, scanned, cohort, neverScanned } = view;
  const x = (n: number) => r2((Math.max(0, Math.min(total, n)) / Math.max(1, total)) * W);
  const scannedX = x(scanned);
  const cohortX = isNum(cohort) ? x(cohort) : 0;

  const ariaLabel =
    `Repository coverage: ${scanned} of ${total} scanned` +
    (neverScanned > 0 ? `, ${neverScanned} never scanned` : "") +
    (isNum(cohort)
      ? `, ${cohort} scanned on both sides of the week and carrying every headline delta.`
      : ". No repository has a scan on both sides of the week, so the headline deltas have no cohort and are not shown.");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <VizDefs />

        <rect x={0} y={BAR_Y} width={W} height={BAR_H} rx={2} fill="var(--color-divider)" fillOpacity={0.25} />
        {neverScanned > 0 && (
          <g data-never-scanned>
            <rect x={scannedX} y={BAR_Y} width={r2(W - scannedX)} height={BAR_H} rx={2} fill={`url(#${HATCH_ID})`} />
            <title>{stateTitle("not-judged", `${neverScanned} repositories with no scan`)}</title>
          </g>
        )}
        <rect data-scanned x={0} y={BAR_Y} width={scannedX} height={BAR_H} rx={2} fill="var(--color-accent)" fillOpacity={0.28} />

        {isNum(cohort) ? (
          <g data-cohort>
            <rect x={0} y={BAR_Y} width={cohortX} height={BAR_H} rx={2} fill="var(--color-accent)" fillOpacity={0.8} />
            <text x={r2(cohortX + 4)} y={H - 2} fontSize={7.5} className="fill-slate-400 font-mono tabular-nums">
              {cohort} compared
            </text>
            <title>{`${cohort} repositories scanned on both sides of the week — the denominator every headline delta is measured over.`}</title>
          </g>
        ) : (
          <g data-cohort-void>
            <line
              data-void
              x1={2}
              y1={BAR_Y + BAR_H / 2}
              x2={Math.max(2, scannedX - 2)}
              y2={BAR_Y + BAR_H / 2}
              stroke="var(--color-divider)"
              strokeWidth={1}
              strokeDasharray={VOID_DASH}
            />
            <title>{stateTitle("missing", "Comparison cohort")}</title>
          </g>
        )}

        <text x={W} y={H - 2} textAnchor="end" fontSize={7.5} className="fill-slate-500 font-mono tabular-nums">
          {scanned}/{total} scanned
        </text>
      </svg>
    </div>
  );
}
