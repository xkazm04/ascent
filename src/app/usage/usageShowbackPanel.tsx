// THE SHOWBACK MATRIX — lane × team, the join the two panels above it cannot make between them.
//
// A SERVER COMPONENT — no `"use client"`, no hooks, no handlers. It renders a grid the page already
// resolved (`summary.byLaneTeam`), laid out by the pure `buildShowbackMatrix`.
//
// Spec #11 promised this and MC-B19 sequenced it behind real data: until MC-B19(b) stamped `teamKey`
// on the local lane's UsageEvents, every non-scan row read "Org-wide" and this would have been a
// one-column table pretending to be a matrix. That is still the state on a host where no repo has a
// CODEOWNERS default owner — so the panel checks, and says attribution is accruing instead of drawing
// a grid. The honesty rules are the lane table's, restated in `usage-showback.ts`.

import { Surface } from "@/components/ui";
import { LANE_LABEL, type UsageLane } from "@/lib/llm/meter";
// Deep paths, not the barrel: the `@/lib/db` re-export is a Director-owned line that lands at merge.
import { UNKNOWN_LANE, type LaneKey, type LaneUsage, type TeamUsage } from "@/lib/db/usage-events";
import { buildShowbackMatrix, type LaneTeamCell } from "@/lib/db/usage-showback";

function laneLabel(lane: LaneKey): string {
  return lane === UNKNOWN_LANE ? "Unrecognized lane" : LANE_LABEL[lane as UsageLane];
}

/** "$1.23", or the honest absence — the same rule, and the same words, the lane table uses. A null
 *  cost is never $0.00: those are different facts. */
function cost(usd: number | null): string {
  return usd == null ? "no estimate" : `$${usd.toFixed(2)}`;
}

/** One intersection. `null` in means NOTHING WAS RECORDED for that (lane, team) — rendered as an
 *  em dash, never as 0, because absence of a record is not evidence of no spend. */
function Cell({ cell }: { cell: LaneTeamCell | null }) {
  if (!cell) {
    return (
      <td className="border-l border-divider/60 px-3 py-2 text-right align-top">
        <span className="type-mono-sm text-slate-600" title="Nothing recorded for this lane and team in this period — not a measured zero.">
          —
        </span>
      </td>
    );
  }
  return (
    <td className="border-l border-divider/60 px-3 py-2 text-right align-top">
      <span className={`block font-mono tabular-nums ${cell.estimatedCostUsd == null ? "text-slate-500" : "text-slate-200"}`}>
        {cost(cell.estimatedCostUsd)}
      </span>
      <span className="block type-micro text-slate-500">
        {cell.calls.toLocaleString()} call{cell.calls === 1 ? "" : "s"}
        {cell.unpricedCalls > 0 && (
          <span title="These calls could not be priced (no rate for the model, your own provider account, or no tokens reported), so the figure above is a floor.">
            {" "}
            · {cell.unpricedCalls.toLocaleString()} unpriced
          </span>
        )}
      </span>
    </td>
  );
}

export function ShowbackMatrixPanel({
  byLaneTeam,
  byLane,
  byTeam,
  periodDays,
}: {
  byLaneTeam: LaneTeamCell[];
  byLane: LaneUsage[];
  byTeam: TeamUsage[];
  periodDays: number;
}) {
  // Nothing in the ledger at all: the lane table above already says the period is empty, and a second
  // panel repeating it adds nothing.
  if (byLaneTeam.length === 0) return null;
  const matrix = buildShowbackMatrix(byLaneTeam, byLane, byTeam);
  return (
    <Surface className="mt-6 p-6">
      <h2 className="type-body font-semibold text-white">
        Showback <span className="font-normal text-slate-500">· lane × team · last {periodDays}d</span>
      </h2>
      {matrix.unattributed ? (
        // NOT an empty grid of zeros. Attribution IS running — the local lane resolves a repo's
        // CODEOWNERS default owner on every metered call — it just has not resolved one yet on this
        // host, and a table of "Org-wide / $0.00" would read as a finding rather than as a wait.
        <p className="mt-3 max-w-2xl type-body-sm leading-relaxed text-slate-400">
          <span className="text-slate-300">Attribution is on, and accruing.</span> Every metered call
          records the CODEOWNERS team that owns the repository it was made for, but nothing in the last{" "}
          {periodDays} days has resolved to one — so far all of this period&apos;s work is org-wide (a
          briefing, a memory pass) or in a repository with no default owner. The matrix appears here as
          soon as one team&apos;s work is attributed. Until then the two panels above are the whole
          picture, and neither is missing anything.
        </p>
      ) : (
        <>
          {/* Wide by construction — one column per team. It scrolls inside its own container so the
              page body never scrolls sideways. */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse type-body-sm">
              <thead>
                <tr className="border-b border-divider">
                  <th scope="col" className="px-3 py-2 text-left font-normal type-label tracking-widest text-slate-500">
                    Lane
                  </th>
                  {matrix.teams.map((t) => (
                    <th
                      key={t.key ?? "org-wide"}
                      scope="col"
                      className={`border-l border-divider/60 px-3 py-2 text-right font-normal type-label tracking-widest ${t.key ? "text-slate-400" : "text-slate-500"}`}
                      title={t.key ? undefined : "Work with no owning repository team — counted, never dropped."}
                    >
                      {t.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-divider/60">
                {matrix.rows.map((r) => (
                  <tr key={r.lane}>
                    <th scope="row" className="px-3 py-2 text-left font-normal text-slate-300">
                      {laneLabel(r.lane)}
                    </th>
                    {r.cells.map((c, i) => (
                      <Cell key={matrix.teams[i]!.key ?? "org-wide"} cell={c} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 type-body-sm text-slate-500">
            The same calls the two panels above count, split both ways at once. An em dash is a pair
            with nothing recorded, not a measured zero; &ldquo;no estimate&rdquo; is a pair that ran and
            could not be priced. A team is a CODEOWNERS team, never a person, and work with no owning
            team is counted org-wide rather than dropped.
          </p>
        </>
      )}
    </Surface>
  );
}
