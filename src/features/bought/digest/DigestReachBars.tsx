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

import {
  VOID_DASH,
  isNum,
  r2,
  rendersValue,
  stateFill,
  stateTitle,
} from "@/components/org/viz";
import type { ActionBar } from "./digestViz";

const LABEL_W = 124;
const BAR_X = LABEL_W;
const BAR_W = 108;
const PTS_X = BAR_X + BAR_W + 8;
const W = PTS_X + 52;
const ROW_H = 22;
const HEAD_H = 12;
const BAR_H = 10;

/** Titles are catalog strings of unbounded length; the row is a bar, not a paragraph. */
const short = (s: string) => (s.length > 21 ? `${s.slice(0, 20)}…` : s);
const ptsLabel = (n: number) => `≈+${n} pts`;

function rowSentence(b: ActionBar): string {
  const reach = `${b.repoCount} ${b.repoCount === 1 ? "repository" : "repositories"}`;
  const lift = b.lifts > 0 ? `, ${b.lifts} of them up a level` : "";
  const pts = isNum(b.perRepo) ? `, ${ptsLabel(b.perRepo)} each` : ", no projection for this move";
  return `Rank ${b.rank}, ${b.title} (${b.dimId} ${b.dimLabel}): reaches ${reach}${lift}${pts}`;
}

export function DigestReachBars({ bars, maxRepos }: { bars: ActionBar[]; maxRepos: number }) {
  const H = HEAD_H + bars.length * ROW_H;
  const ariaLabel = `Reach of the three ranked moves. ${bars.map(rowSentence).join("; ")}.`;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>

        <text x={BAR_X} y={HEAD_H - 4} fontSize={7} className="fill-slate-500 font-mono uppercase tracking-[0.18em]">
          repos reached
        </text>
        <text x={PTS_X} y={HEAD_H - 4} fontSize={7} className="fill-slate-500 font-mono uppercase tracking-[0.18em]">
          per repo
        </text>

        {bars.map((b, i) => {
          const mid = HEAD_H + i * ROW_H + ROW_H / 2;
          const w = r2(Math.max(2, (b.repoCount / maxRepos) * BAR_W));
          const liftW = r2((b.lifts / maxRepos) * BAR_W);
          return (
            <g key={b.rank} data-rank={b.rank} data-points-state={b.pointsState}>
              <text x={0} y={mid + 3} fontSize={8.5} className="fill-slate-300 font-mono">
                {b.rank}. {short(b.title)}
              </text>

              <rect
                data-reach
                x={BAR_X}
                y={mid - BAR_H / 2}
                width={w}
                height={BAR_H}
                rx={2}
                fill={stateFill("measured")}
                fillOpacity={0.3}
              />
              {b.lifts > 0 && (
                <>
                  {/* the subset that crosses a level edge — a different fact from the reach */}
                  <rect data-lifts x={BAR_X} y={mid - BAR_H / 2} width={liftW} height={BAR_H} rx={2} fill={stateFill("measured")} fillOpacity={0.85} />
                  <line x1={r2(BAR_X + liftW)} y1={mid - BAR_H / 2 - 2} x2={r2(BAR_X + liftW)} y2={mid + BAR_H / 2 + 2} stroke="var(--color-accent)" strokeWidth={1} />
                </>
              )}
              <text x={r2(BAR_X + w + 4)} y={mid + 3} fontSize={8} className="fill-slate-400 font-mono tabular-nums">
                {b.repoCount}
              </text>

              {rendersValue(b.pointsState) && isNum(b.perRepo) ? (
                <text data-pts x={PTS_X} y={mid + 3} fontSize={8.5} className="fill-slate-300 font-mono tabular-nums">
                  {ptsLabel(b.perRepo)}
                </text>
              ) : (
                <line data-void x1={PTS_X} y1={mid} x2={W - 6} y2={mid} stroke="var(--color-divider)" strokeWidth={1} strokeDasharray={VOID_DASH} />
              )}
              <title>
                {rendersValue(b.pointsState)
                  ? rowSentence(b)
                  : `${rowSentence(b)}. ${stateTitle("missing", "Projected points")}`}
              </title>
            </g>
          );
        })}
      </svg>

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
