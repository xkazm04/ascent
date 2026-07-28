"use client";

import { STATUS_LABEL } from "@/components/org/shared/backlogShared";
import type { RecStatus } from "@/lib/types";

/** A completed terminal status change the panel can put back. `from` is the status the item held
 *  immediately before the change, so undo restores the exact prior state, not a guessed "open". */
export interface BacklogUndo {
  id: string;
  title: string;
  from: RecStatus;
  to: RecStatus;
}

/**
 * The backlog's grouping toggle plus the "show done & dismissed" switch. Extracted from BacklogPanel
 * to keep that file under the 300-LOC cap.
 */
export function BacklogViewControls({
  view,
  onView,
  showClosed,
  onToggleClosed,
  closedCount,
  exportHref,
}: {
  view: "owner" | "due" | "points";
  onView: (v: "owner" | "due" | "points") => void;
  showClosed: boolean;
  onToggleClosed: () => void;
  /** done + dismissed across the fleet — named on the toggle so it reads as "there are N to recover". */
  closedCount: number;
  /** CSV download for the CURRENT read scope (G7-13). Omitted → no export affordance. */
  exportHref?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Group backlog by" className="flex items-center gap-1 text-sm">
        <span className="mr-1 font-mono text-sm uppercase tracking-widest text-slate-500">Group by</span>
        {(["owner", "due", "points"] as const).map((v) => (
          <button
            key={v}
            onClick={() => onView(v)}
            aria-pressed={view === v}
            className={`rounded-lg border px-3 py-1.5 font-medium transition ${
              view === v ? "border-accent/50 bg-accent/10 text-white" : "border-slate-700 text-slate-400 hover:text-white"
            }`}
          >
            {v === "owner" ? "Owner" : v === "due" ? "Due date" : "Projected points"}
          </button>
        ))}
      </div>

      {/* G6-02: the route back. Marking an item Done/Dismissed used to remove it from every view for
          good — this reveals those rows so their status control is reachable and the item can be set
          back to Open. aria-pressed (not a checkbox) matches the sibling group-by toggles. */}
      <button
        onClick={onToggleClosed}
        aria-pressed={showClosed}
        title="Reveal done and dismissed items so they can be restored"
        className={`ml-auto rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
          showClosed ? "border-accent/50 bg-accent/10 text-white" : "border-slate-700 text-slate-400 hover:text-white"
        }`}
      >
        {showClosed ? "Hide done & dismissed" : "Show done & dismissed"}
        <span className="ml-1.5 font-mono text-sm text-slate-500">{closedCount}</span>
      </button>

      {/* G7-13: the backlog was the last actionable surface with no CSV, forcing manual re-entry into
          whatever tracker the team actually uses. Plain anchor — the route sets Content-Disposition. */}
      {exportHref && (
        <a
          href={exportHref}
          className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 font-mono text-sm text-slate-400 transition hover:border-accent hover:text-white"
          title="Download the backlog for this scope as CSV"
        >
          Export CSV ↓
        </a>
      )}
    </div>
  );
}

/**
 * The undo affordance for a completed terminal status change (G6-02).
 *
 * Deliberately NOT a confirm dialog and NOT a self-dismissing toast: a confirm taxes every one of the
 * many correct status changes to guard the rare wrong one, and a timed toast puts the user under a
 * clock — the same trap in slower motion. This stays until the next change or an explicit dismiss.
 */
export function BacklogUndoBar({
  undo,
  busy,
  onUndo,
  onDismiss,
}: {
  undo: BacklogUndo;
  busy: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm"
    >
      <span className="min-w-0 text-slate-300">
        <span className="font-medium text-white">{undo.title}</span> marked{" "}
        <span className="font-mono text-slate-400">{STATUS_LABEL[undo.to]}</span>
        {/* Name the consequence: the row is gone from this list, which is the whole reason undo exists. */}
        <span className="text-slate-500"> — removed from the active backlog.</span>
      </span>
      <button
        onClick={onUndo}
        disabled={busy}
        className="focus-ring ml-auto rounded-lg border border-accent/50 bg-accent/10 px-3 py-1 font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
      >
        {busy ? "Undoing…" : `Undo (back to ${STATUS_LABEL[undo.from]})`}
      </button>
      <button
        onClick={onDismiss}
        aria-label="Dismiss undo"
        className="focus-ring rounded font-mono text-slate-600 transition hover:text-slate-300"
      >
        ×
      </button>
    </div>
  );
}
