// The three ranked moves, drawn: how far each one reaches, how many repos it would lift a level, and
// what it is projected to buy per repository.
//
// The header this replaces claimed the ranking was "by projected fleet gain over the repos each one
// lifts". IT IS NOT — `getOrgRecommendations` sorts by `leverage` (reach × impact weight × dimension
// weight), and `projectedPoints` is a separate, per-repository figure that the ranking never reads.
// Drawing the two as what they are keeps the panel from asserting a basis it does not have: the bar
// is the exact count of repositories carrying the gap, the rung inside it is the subset the move
// would push up a maturity level, and the points ride the row as a per-repo figure. The real ranking
// rule is disclosed on the header (WhyChip), where a basis belongs.
//
// A move with no projection (no affected repo had persisted dimension scores) is `missing`: the bar
// still draws its reach — that IS measured — and the points column draws a void with no numeral,
// because `rendersValue("missing")` is false. Before, an unprojected move and a low-value one were
// indistinguishable: both simply omitted the phrase.
//
// Layout is an HTML grid in the `type-*` scale (the Ledger direction): the move title is a real
// column that wraps rather than being cut at 21 characters, and only the reach bar, the lift rung
// and the void are SVG — no viewBox, percentages of the cell — so nothing scales with the panel.

import { isNum, r2, rendersValue, stateFill, stateTitle } from "@/components/org/viz";
import { COLUMN_HEAD, MarkSvg, VoidRule, pctLen } from "../barRowMarks";
import type { ActionBar } from "./digestViz";

/** move · reach bar (with its count) · per-repo points — one template for the head and every row. */
const TEMPLATE = "minmax(7rem, 1.2fr) minmax(5rem, 1fr) 6.5rem";
const GRID = "grid gap-x-3";
/** Bar geometry inside the 14px track, in CSS pixels (no viewBox, so they cannot stretch). */
const BAR_Y = 2;
const BAR_H = 10;
const TRACK_H = 14;
/** The shortest reach bar, as a share of the track. */
const MIN_BAR_PCT = 1.85;

const ptsLabel = (n: number) => `≈+${n} pts`;

function rowSentence(b: ActionBar): string {
  const reach = `${b.repoCount} ${b.repoCount === 1 ? "repository" : "repositories"}`;
  const lift = b.lifts > 0 ? `, ${b.lifts} of them up a level` : "";
  const pts = isNum(b.perRepo) ? `, ${ptsLabel(b.perRepo)} each` : ", no projection for this move";
  return `Rank ${b.rank}, ${b.title} (${b.dimId} ${b.dimLabel}): reaches ${reach}${lift}${pts}`;
}

export function DigestReachBars({ bars, maxRepos }: { bars: ActionBar[]; maxRepos: number }) {
  const ariaLabel = `Reach of the three ranked moves. ${bars.map(rowSentence).join("; ")}.`;

  return (
    <div>
      <div role="img" aria-label={ariaLabel}>
        <div aria-hidden className={`${GRID} items-end border-b border-divider pb-1.5`} style={{ gridTemplateColumns: TEMPLATE }}>
          <span />
          <span className={COLUMN_HEAD}>repos reached</span>
          <span className={COLUMN_HEAD}>per repo</span>
        </div>

        {bars.map((b) => {
          const w = Math.max(MIN_BAR_PCT, r2((b.repoCount / maxRepos) * 100));
          const liftW = r2((b.lifts / maxRepos) * 100);
          return (
            <div
              key={b.rank}
              data-rank={b.rank}
              data-points-state={b.pointsState}
              title={rendersValue(b.pointsState) ? rowSentence(b) : `${rowSentence(b)}. ${stateTitle("missing", "Projected points")}`}
              className={`${GRID} min-h-8 items-center border-b border-divider/50 py-1 last:border-b-0`}
              style={{ gridTemplateColumns: TEMPLATE }}
            >
              <span className="type-caption leading-tight text-slate-300 [overflow-wrap:anywhere]">
                {b.rank}. {b.title}
              </span>

              {/* The right padding is the room the count needs when the bar fills its track. */}
              <div className="pr-8">
                <div className="relative h-3.5">
                  <MarkSvg className="h-full">
                    <rect
                      data-reach
                      x={0}
                      y={BAR_Y}
                      width={pctLen(w)}
                      height={BAR_H}
                      rx={2}
                      fill={stateFill("measured")}
                      fillOpacity={0.3}
                    />
                    {b.lifts > 0 && (
                      <>
                        {/* the subset that crosses a level edge — a different fact from the reach */}
                        <rect data-lifts x={0} y={BAR_Y} width={pctLen(liftW)} height={BAR_H} rx={2} fill={stateFill("measured")} fillOpacity={0.85} />
                        <line x1={pctLen(liftW)} y1={0} x2={pctLen(liftW)} y2={TRACK_H} stroke="var(--color-accent)" strokeWidth={1} />
                      </>
                    )}
                  </MarkSvg>
                  <span
                    className="type-caption absolute top-1/2 -translate-y-1/2 pl-1 tabular-nums text-slate-400"
                    style={{ left: pctLen(w) }}
                  >
                    {b.repoCount}
                  </span>
                </div>
              </div>

              {rendersValue(b.pointsState) && isNum(b.perRepo) ? (
                <span data-pts className="type-caption tabular-nums text-slate-300">
                  {ptsLabel(b.perRepo)}
                </span>
              ) : (
                <MarkSvg className="h-2">
                  <VoidRule to={90} />
                </MarkSvg>
              )}
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>Reach of the three ranked moves</caption>
        <thead>
          <tr>
            <th scope="col">Move</th>
            <th scope="col">Repositories reached</th>
            <th scope="col">Advanced a level</th>
            <th scope="col">Projected points per repository</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.rank}>
              <th scope="row">
                {b.rank}. {b.title}
              </th>
              <td>{b.repoCount}</td>
              <td>{b.lifts}</td>
              <td>{isNum(b.perRepo) ? ptsLabel(b.perRepo) : "No projection"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
