"use client";

// The proposed-batch ledger's BODY — empty states, the head with its keep-all box, and the rows — shared by both
// compositions of the ledger (v1 header in CockpitBatchLedger, the Prism header in CockpitBatchLedger.v2). Only the
// header above it differs per theme; `dimMark` lets a composition name a row's dimension its own way.
import type { ReactNode } from "react";
import { OrgTable, SectionEmpty } from "@/components/org/shared/ui";
import { ImpactEffort, Points } from "@/components/org/followups/FollowupChips";
import { BatchLedgerRow } from "./CockpitBatchLedgerRow";
import { BatchRepairPairing } from "./BatchRepairPairing";
import type { BatchRow } from "./cockpitBatchRows";
import type { CockpitBatchLedgerProps } from "./CockpitBatchLedger";

export function CockpitBatchTable({
  p,
  rows,
  dimMark,
}: {
  p: CockpitBatchLedgerProps;
  rows: BatchRow[];
  /** A row's dimension cell. Absent = the shipped plain id. */
  dimMark?: (dimId: string, label: string) => ReactNode;
}) {
  const itemIds = rows.filter((r) => r.kind === "item").map((r) => r.id);
  const allKept = itemIds.length > 0 && itemIds.every((id) => !p.pruned.has(id));
  return (
    <>
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
              dimMark={dimMark}
              row={row}
              pruned={p.pruned.has(row.id)}
              onToggle={() => p.onTogglePrune(row.id)}
              chips={row.kind === "item" ? <ImpactEffort r={row.item} /> : null}
              points={row.kind === "item" ? <Points n={row.item.projectedPoints} /> : null}
              detail={
                row.kind === "broken" ? (
                  <BatchRepairPairing
                    slug={p.repair?.slug ?? ""}
                    repo={row.repo}
                    error={row.error}
                    canRepair={p.repair?.canRepair === true}
                    onRepaired={p.repair?.onRepaired ?? (() => {})}
                  />
                ) : null
              }
            />
          ))}
        </OrgTable>
      )}
    </>
  );
}
