"use client";

// A cell's GAP ROWS — one row per individual gap/deliverable, grouped under a kind heading when the
// cell mixes kinds (Closed · Installed · Hardened · Regressed · Proposed), a leading glyph when it
// does not. EVERY gap gets a row (a long lane scrolls inside the frame rather than collapsing —
// max-h + overflow, never "+n more"): each row is a decision surface, tinted by its state and
// carrying the ✓/✕ quick-approval controls. "details" widens the evidence line under each headline,
// the per-dimension deltas and the movement prose — the number and the words answer to the same
// verdict, so neither is printed at a glance.

import { useState } from "react";
import { CellDims } from "./OutcomeCell";
import type { OutcomeCell as Cell } from "./outcomeMatrix";
import { KIND_META, sectionDeliverables } from "./outcomeDeliverables";
import { OutcomeGapRow, type ReviewHandler } from "./OutcomeGapRow";

export function CellDeliverables({ cell, canReview, onReview }: { cell: Cell; canReview?: boolean; onReview?: ReviewHandler }) {
  const [open, setOpen] = useState(false);
  const sections = sectionDeliverables(cell.rows);
  if (sections.length === 0) return <p className="type-caption text-slate-600">nothing delivered</p>;
  const mixed = sections.length > 1;
  return (
    <div>
      <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
        {sections.map((s) => (
          <li key={s.kind}>
            {mixed && (
              <p className={`type-micro mt-1.5 font-mono uppercase tracking-[0.14em] first:mt-0 ${s.kind === "regressed" ? "text-warn" : "text-slate-500"}`}>
                {s.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {s.rows.map((row) => (
                <OutcomeGapRow
                  key={`${row.covers[0] ?? ""}|${row.headline}`}
                  row={row}
                  glyph={mixed ? null : KIND_META[s.kind].glyph}
                  open={open}
                  canReview={canReview}
                  onReview={onReview}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {open && (
        <>
          <CellDims cell={cell} />
          {cell.movements.map((line) => (
            <p key={line} className="type-note mt-1 text-slate-400">
              {line}
            </p>
          ))}
        </>
      )}
      <button type="button" onClick={() => setOpen(!open)} className="focus-ring type-micro mt-1 text-slate-500 hover:text-slate-300">
        {open ? "less" : "details"}
      </button>
    </div>
  );
}
