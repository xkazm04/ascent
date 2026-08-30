"use client";

// ONE GAP ROW — the Storyboard's unit of display AND of decision. The state is a subtle tinted
// block (never a loud chip): success for committed, warn for uncommitted (the lost-deliverable
// case), a whisper of accent for proposed. The quick-approval gate sits at the row's right edge:
// ✓ / ✕, keyboard-operable, one click each — the loop proposes, the human disposes. An approved
// row keeps its tint and gains a ✓; a dismissed row drops to a strikethrough-free slate mute.

import { dimShort } from "@/lib/ui";
import { rowCover, type DeliverableState, type GapRow } from "./outcomeGapRows";

export type ReviewHandler = (laneId: string, cover: string, verdict: "approved" | "dismissed") => void;

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

export function OutcomeGapRow({
  row,
  glyph,
  open,
  canReview,
  onReview,
}: {
  row: GapRow;
  glyph: string | null;
  open: boolean;
  canReview?: boolean;
  onReview?: ReviewHandler;
}) {
  const dismissed = row.review === "dismissed";
  const down = row.kind === "regressed";
  const text = dismissed ? "text-slate-600" : down ? "text-warn" : "text-slate-200";
  return (
    <li className={`rounded px-1.5 py-0.5 ${dismissed ? "" : STATE_TINT[row.state]}`} title={STATE_TITLE[row.state]}>
      <div className="flex items-baseline gap-2">
        {glyph && (
          <span aria-hidden className={`type-caption w-3 shrink-0 text-center ${down && !dismissed ? "text-warn" : "text-slate-500"}`}>
            {glyph}
          </span>
        )}
        <span className={`type-body-sm min-w-0 flex-1 truncate ${text}`} title={row.evidence ?? row.headline}>
          {row.review === "approved" && (
            <span aria-hidden className="mr-1 text-success">
              ✓
            </span>
          )}
          {row.headline}
        </span>
        {row.dimId && <span className="type-micro shrink-0 font-mono text-slate-500">{dimShort(row.dimId)}</span>}
        {canReview && onReview && (
          <span className="flex shrink-0 gap-0.5">
            <button
              type="button"
              aria-label={`Approve "${row.headline}"`}
              aria-pressed={row.review === "approved"}
              onClick={() => onReview(row.laneId, rowCover(row), "approved")}
              className={`focus-ring type-caption rounded px-1 ${row.review === "approved" ? "text-success" : "text-slate-600 hover:text-success"}`}
            >
              ✓
            </button>
            <button
              type="button"
              aria-label={`Dismiss "${row.headline}"`}
              aria-pressed={dismissed}
              onClick={() => onReview(row.laneId, rowCover(row), "dismissed")}
              className={`focus-ring type-caption rounded px-1 ${dismissed ? "text-slate-400" : "text-slate-600 hover:text-slate-300"}`}
            >
              ✕
            </button>
          </span>
        )}
      </div>
      {open && row.evidence && row.evidence !== row.headline && (
        <p className={`type-note mt-0.5 text-slate-500 ${glyph ? "pl-5" : ""}`}>{row.evidence}</p>
      )}
    </li>
  );
}
