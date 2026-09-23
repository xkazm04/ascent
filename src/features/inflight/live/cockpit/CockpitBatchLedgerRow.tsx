"use client";

// ONE ROW of the proposed-batch ledger. Co-located with `CockpitBatchLedger` (which stays the header,
// the arithmetic and the table shell) so both sit inside the 200-line cap.
//
// A PRUNED ROW STAYS ON THE PAGE, struck through and muted rather than removed: the operator has to be
// able to put it back, and a row that vanishes when you untick it reads as a deletion of the item
// itself, which this ledger never does. Nothing here writes to the backlog — a tick is a statement
// about ONE run.
//
// The lane, unpaired and broken rows carry no checkbox at all, because there is nothing about them to
// decide: an install lane has no items to curate, and an unpaired or broken-pairing repo cannot run
// whatever it proposed. A broken row's proposal cell is `detail` (the inline re-pair) when given.

import type { BatchRow } from "./cockpitBatchRows";

const LANE_TAG = "ml-2 whitespace-nowrap rounded border border-accent/40 px-1 type-micro uppercase tracking-wide text-accent";

export function BatchLedgerRow({
  row,
  pruned,
  onToggle,
  chips,
  points,
  detail,
}: {
  row: BatchRow;
  pruned: boolean;
  onToggle: () => void;
  chips: React.ReactNode;
  points: React.ReactNode;
  /** Replaces the note in the proposal cell (the broken row's inline re-pair). */
  detail?: React.ReactNode;
}) {
  const muted = row.kind !== "item" || pruned;
  return (
    <tr className={muted ? "opacity-70" : ""}>
      <td className="px-3 py-1.5 align-top">
        {row.kind === "item" && (
          <input
            type="checkbox"
            checked={!pruned}
            onChange={onToggle}
            aria-label={`Keep "${row.item.title}" in this run`}
            className="accent-accent"
          />
        )}
      </td>
      <td className="px-3 py-1.5 align-top">
        <span className="whitespace-nowrap type-caption text-slate-400" title={row.repo}>
          {row.repoName}
        </span>
        {row.laneTag && <span className={LANE_TAG}>{row.laneTag}</span>}
      </td>
      <td className="px-3 py-1.5 align-top">
        {row.kind === "item" ? (
          <span className="whitespace-nowrap type-caption text-slate-400" title={row.item.dimLabel}>
            {row.item.dimId}
          </span>
        ) : (
          <span className="type-caption text-slate-600">—</span>
        )}
      </td>
      <td className="px-3 py-1.5 align-top">
        {detail ? (
          detail
        ) : row.kind === "item" ? (
          <span className={`type-body-sm ${pruned ? "text-slate-600 line-through" : "text-slate-100"}`}>{row.item.title}</span>
        ) : (
          <span className="min-w-0">
            <span className={`type-caption ${row.kind === "unpaired" || row.kind === "broken" ? "text-warn" : "text-slate-500"}`}>{row.note}</span>
            {row.curation && <span className="ml-2 type-caption text-slate-600">{row.curation}</span>}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 align-top">{chips ?? <span className="type-caption text-slate-600">—</span>}</td>
      <td className="px-3 py-1.5 text-right align-top">{points ?? <span className="type-caption text-slate-600">—</span>}</td>
    </tr>
  );
}
