"use client";

// ONE CELL of the sheet — (gap row × run column) — and the sheet's unit of DECISION. The state is a
// subtle tinted block, never a loud chip: success for committed, warn for uncommitted (the
// lost-deliverable case), a whisper of accent for proposed. The ✓/✕ quick-approval gate sits at the
// cell's right edge for an owner: the loop proposes, the human disposes.
//
// PROGRESSIVE DISCLOSURE BY WIDTH. There is no "details" toggle — a per-cell expander in a sheet this
// wide produced a mess. Everything the cell knows rides in its `title`; the COLUMN'S WIDTH decides how
// much of it is also on the page: the marker and the run's own headline always, the dimension short
// label past REVEAL_DIM_PX, the evidence line past REVEAL_EVIDENCE_PX. Drag the column, see more.
//
// A blank cell is normal and is the whole point of the sheet: it says this run did not touch this gap.

import { dimShort } from "@/lib/ui";
import { KIND_META } from "./outcomeDeliverables";
import type { DeliverableState } from "./outcomeGapRows";
import type { CellReviewHandler, SheetGapCell } from "./outcomeSheetModel";
import { REVEAL_DIM_PX, REVEAL_EVIDENCE_PX } from "./useColumnWidths";

const STATE_TINT: Record<DeliverableState, string> = {
  committed: "bg-success/10",
  uncommitted: "bg-warn/10",
  proposed: "bg-accent/5",
};

const STATE_TITLE: Record<DeliverableState, string> = {
  committed: "Committed — covered by real commits on the lane's branch",
  uncommitted: "Uncommitted — claimed RESOLVED, but the lane recorded no commits",
  proposed: "Proposed — armed by the run, not resolved",
};

export function OutcomeSheetCell({
  cell,
  width,
  canReview,
  onReview,
}: {
  cell: SheetGapCell | null;
  width: number;
  canReview?: boolean;
  onReview?: CellReviewHandler;
}) {
  if (!cell) return <td className="border-b border-l border-divider bg-ink" />;
  const dismissed = cell.review === "dismissed";
  const down = cell.kind === "regressed";
  const tone = dismissed ? "text-slate-600" : down ? "text-warn" : "text-slate-200";
  const evidence = cell.evidence && cell.evidence !== cell.headline ? cell.evidence : null;
  const title = [STATE_TITLE[cell.state], cell.headline, evidence].filter(Boolean).join(" — ");

  return (
    <td className={`border-b border-l border-divider align-top ${dismissed ? "bg-ink" : STATE_TINT[cell.state]}`} title={title}>
      <div className="flex items-baseline gap-1.5 px-2 py-1.5">
        <span aria-hidden className={`type-caption w-3 shrink-0 text-center ${down && !dismissed ? "text-warn" : "text-slate-500"}`}>
          {KIND_META[cell.kind].glyph}
        </span>
        <span className="sr-only">{cell.state}. </span>
        <span className={`type-body-sm min-w-0 flex-1 truncate ${tone}`}>
          {cell.review === "approved" && (
            <span aria-hidden className="mr-1 text-success">
              ✓
            </span>
          )}
          {cell.headline}
        </span>
        {width >= REVEAL_DIM_PX && cell.dimId && (
          <span className="type-micro shrink-0 font-mono tabular-nums text-slate-500">{dimShort(cell.dimId)}</span>
        )}
        {canReview && onReview && (
          <span className="flex shrink-0 gap-0.5">
            <button
              type="button"
              aria-label={`Approve "${cell.headline}"`}
              aria-pressed={cell.review === "approved"}
              onClick={() => onReview(cell.runId, cell.laneId, cell.cover, "approved")}
              className={`focus-ring type-caption rounded px-1 ${cell.review === "approved" ? "text-success" : "text-slate-600 hover:text-success"}`}
            >
              ✓
            </button>
            <button
              type="button"
              aria-label={`Dismiss "${cell.headline}"`}
              aria-pressed={dismissed}
              onClick={() => onReview(cell.runId, cell.laneId, cell.cover, "dismissed")}
              className={`focus-ring type-caption rounded px-1 ${dismissed ? "text-slate-400" : "text-slate-600 hover:text-slate-300"}`}
            >
              ✕
            </button>
          </span>
        )}
      </div>
      {width >= REVEAL_EVIDENCE_PX && evidence && <p className="type-note px-2 pb-1.5 pl-7 text-slate-500">{evidence}</p>}
    </td>
  );
}
