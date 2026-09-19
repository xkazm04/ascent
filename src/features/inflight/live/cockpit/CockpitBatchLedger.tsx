"use client";

// THE PROPOSED BATCH — what the next run would actually work, as a LEDGER under the sky.
//
// WHERE IT WAS. In the 18rem right rail, as one bordered card per repo with a checkbox list inside,
// under ten dials. Three repos of five items each made the rail a scroll, the item titles wrapped to
// three lines apiece, and the one question the panel exists to answer — *is this the right work?* —
// needed a column comparison the layout could not give.
//
// WHERE IT IS. The main content column, in the Proposals ledger's own shape (`ProposalsWorklist`):
// one flat row per item, repo · dimension · proposal · impact/effort · projected points, ticked to
// keep. The vocabulary is literally shared — `ImpactEffort` and `Points` from the follow-ups chips,
// `OrgTable` from the org shell — so a gap looks the same wherever Ascent shows it, and an operator
// who has curated in Proposals already knows how to curate here.
//
// WHY NOT `DecisionTable`. That component's selection means "rows this batch action will act on", and
// settles by running an action from a sticky bar. Here a tick means "keep this in the run" — the
// inverse polarity — and the action is the cockpit's own Run/Drive CTA in the rail, not a bar of this
// table's own. Same primitives underneath, honest semantics on top.

import { Kicker } from "@/components/ui";
import { OrgTable, SectionEmpty } from "@/components/org/shared/ui";
import { ImpactEffort, Points } from "@/components/org/followups/FollowupChips";
import { batchRows, batchTotals } from "./cockpitBatchRows";
import { BatchLedgerRow } from "./CockpitBatchLedgerRow";
import type { LoopProposal } from "./loopTypes";

export interface CockpitBatchLedgerProps {
  proposals: LoopProposal[];
  pruned: ReadonlySet<string>;
  onTogglePrune: (id: string) => void;
  /** Only show items on this dimension; null = all. Set from the run-setup dialog's Focus dial. */
  dimFocus: string | null;
  /** Selected repos with no local pairing — flagged, and excluded from the run. */
  unpaired: ReadonlySet<string>;
  /** Repos are selected but the proposal fetch has not landed yet. */
  loading?: boolean;
  /** Nothing is selected at all — a different state from "selected, and nothing open". */
  empty?: boolean;
}

export function CockpitBatchLedger(p: CockpitBatchLedgerProps) {
  const rows = batchRows(p.proposals, p.unpaired, p.dimFocus);
  const totals = batchTotals(rows, p.pruned);
  const itemIds = rows.filter((r) => r.kind === "item").map((r) => r.id);
  const allKept = itemIds.length > 0 && itemIds.every((id) => !p.pruned.has(id));

  return (
    <section aria-label="Proposed batch" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-divider pb-2">
        <div className="min-w-0">
          <Kicker tone="accent">Proposed batch</Kicker>
          <p className="mt-0.5 type-caption text-slate-500">
            What the next run would work. Untick a row to leave it out; the run dispatches what stays.
          </p>
        </div>
        <p className="type-mono-sm shrink-0 text-slate-400">
          <span className="tabular-nums text-slate-100">{totals.items}</span> item{totals.items === 1 ? "" : "s"} ·{" "}
          <span className="tabular-nums">{totals.repos}</span> repo{totals.repos === 1 ? "" : "s"} ·{" "}
          <span className="tabular-nums text-white">+{totals.points}</span> projected
          {totals.pruned > 0 && <span className="text-slate-600"> · {totals.pruned} pruned</span>}
          {totals.unpaired > 0 && <span className="text-warn"> · {totals.unpaired} unpaired</span>}
        </p>
      </div>

      {p.empty ? (
        <SectionEmpty>Lasso or click bodies in the sky to see what a run would work.</SectionEmpty>
      ) : p.loading ? (
        <SectionEmpty>Reading each repo&rsquo;s open follow-ups…</SectionEmpty>
      ) : rows.length === 0 ? (
        <SectionEmpty>No open follow-ups in this selection.</SectionEmpty>
      ) : (
        <OrgTable
          minWidth={720}
          caption="Proposed batch"
          head={
            <tr className="text-left">
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allKept}
                  disabled={itemIds.length === 0}
                  aria-label="Keep every proposed item"
                  onChange={() => {
                    for (const id of itemIds) {
                      if (allKept !== p.pruned.has(id)) p.onTogglePrune(id);
                    }
                  }}
                  className="accent-accent"
                />
              </th>
              <th className="px-3 py-2 font-normal">Repo</th>
              <th className="px-3 py-2 font-normal" title="dimension">
                Dim
              </th>
              <th className="px-3 py-2 font-normal">Proposal</th>
              <th className="px-3 py-2 font-normal" title="impact · effort">
                I·E
              </th>
              <th className="px-3 py-2 text-right font-normal">+pts</th>
            </tr>
          }
        >
          {rows.map((row) => (
            <BatchLedgerRow
              key={row.id}
              row={row}
              pruned={p.pruned.has(row.id)}
              onToggle={() => p.onTogglePrune(row.id)}
              chips={row.kind === "item" ? <ImpactEffort r={row.item} /> : null}
              points={row.kind === "item" ? <Points n={row.item.projectedPoints} /> : null}
            />
          ))}
        </OrgTable>
      )}
    </section>
  );
}
