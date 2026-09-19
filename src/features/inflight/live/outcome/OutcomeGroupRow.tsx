"use client";

// A DIMENSION BAND's row — the sheet's collapsed level of detail.
//
// The frozen cell is a disclosure button: the dimension, how many gaps sit under it, and a triangle.
// Every run column then answers the one question a collapsed band still has to answer — *how much of
// this band did that run touch?* — as a COUNT with its state breakdown under it. That is the trade the
// band makes: you lose the individual headlines and you gain a row of directly comparable numbers,
// which is the shape the sheet's column axis was always for.
//
// A BAND IS NOT A CELL AND MUST NOT LOOK LIKE ONE. No state tint, no review buttons: nothing here is
// a decision, and a ✓ over a count would be a ruling on rows the reader cannot see. The band's job is
// to get you to the right rows; the rows keep the verdicts.

import { SheetGroupCell, groupCellCaption, type SheetGroup } from "./outcomeSheetGroups";
import type { OutcomeColumn } from "./outcomeMatrix";

const FROZEN = "sticky left-0 z-10 border-b border-r border-divider bg-ink text-left align-top";

function BandCell({ cell }: { cell: SheetGroupCell | null }) {
  if (!cell) return <td className="border-b border-l border-divider bg-surface/20" />;
  const caption = groupCellCaption(cell);
  return (
    <td className="border-b border-l border-divider bg-surface/20 px-2 py-1.5 align-top">
      <span className="flex items-baseline gap-1.5">
        <span className="type-body-sm tabular-nums text-slate-200">{cell.total}</span>
        <span className="type-micro truncate font-mono text-slate-500" title={caption}>
          {caption}
        </span>
      </span>
      {/* A band the owner has finished ruling on says so once, rather than N times on N hidden rows. */}
      {cell.reviewed > 0 && (
        <span className="type-micro mt-0.5 block font-mono text-slate-600">
          {cell.reviewed === cell.total ? "all reviewed" : `${cell.reviewed} reviewed`}
        </span>
      )}
    </td>
  );
}

export function OutcomeGroupSheetRow({
  group,
  columns,
  open,
  onToggle,
}: {
  group: SheetGroup;
  columns: OutcomeColumn[];
  open: boolean;
  onToggle: () => void;
}) {
  const n = group.rows.length;
  return (
    <tr>
      <th scope="row" className={`${FROZEN} p-0 font-normal`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          data-testid="outcome-band"
          className="focus-ring flex w-full items-baseline gap-2 bg-surface/20 px-3 py-1.5 text-left transition hover:bg-surface/40"
        >
          <span aria-hidden className={`type-micro shrink-0 text-slate-500 transition-transform ${open ? "rotate-90" : ""}`}>
            ▸
          </span>
          <span className="type-body-sm min-w-0 flex-1 truncate text-slate-300">{group.label}</span>
          <span className="type-micro shrink-0 font-mono tabular-nums text-slate-500">
            {n} gap{n === 1 ? "" : "s"}
          </span>
        </button>
      </th>
      {columns.map((col) => (
        <BandCell key={col.id} cell={group.cells[col.id] ?? null} />
      ))}
    </tr>
  );
}
