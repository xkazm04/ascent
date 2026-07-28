"use client";

// The backlog's multi-select action bar (G7-12). Appears only once rows are selected, and states the
// exact count on every button so "Dismiss 40" can never read as "Dismiss".
//
// Bulk status changes are confirmed, not undone: the panel's undo bar restores ONE row, so it can't be
// the safety net for a 40-row action. The confirm names the count and the target status; "show done &
// dismissed" remains the route back for anything closed by mistake.

import { useState } from "react";
import { ConfirmAction } from "@/components/ConfirmAction";
import { STATUS_LABEL } from "@/components/org/shared/backlogShared";
import { MAX_BULK, type BulkState } from "@/components/org/backlog/useBacklogBulk";
import type { RecStatus } from "@/lib/types";

/** The statuses a bulk action can set. Owner/due-date bulk edits are deliberately NOT here — those are
 *  per-item judgements, and a fleet-wide reassignment is not a mis-click anyone recovers from. */
const BULK_STATUSES: readonly RecStatus[] = ["open", "in_progress", "done", "dismissed"];

export function BacklogBulkBar({
  count,
  shownCount,
  bulk,
  onSelectAll,
  onClear,
  onApply,
}: {
  /** Rows currently selected. */
  count: number;
  /** Rows on screen (post-filter) — the ceiling "select all shown" can reach. */
  shownCount: number;
  bulk: BulkState;
  onSelectAll: () => void;
  onClear: () => void;
  onApply: (status: RecStatus) => void;
}) {
  const [pending, setPending] = useState<RecStatus | null>(null);
  const capped = shownCount > MAX_BULK;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky top-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/40 bg-slate-950/90 px-4 py-2.5 text-sm backdrop-blur"
    >
      <span className="font-mono text-white">
        {count > 0 ? `${count} selected` : "No rows selected"}
        {capped && (
          <span className="ml-1.5 text-slate-500" title={`One bulk action applies to at most ${MAX_BULK} items`}>
            · max {MAX_BULK} per action
          </span>
        )}
      </span>
      <button onClick={onSelectAll} className="focus-ring rounded font-mono text-slate-400 hover:text-white">
        select all shown{capped ? ` (${MAX_BULK})` : ""}
      </button>
      <button onClick={onClear} className="focus-ring rounded font-mono text-slate-400 hover:text-white">
        clear
      </button>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Set status</span>
        {BULK_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setPending(s)}
            disabled={bulk.running || count === 0}
            className="focus-ring rounded-lg border border-slate-700 px-2.5 py-1 font-medium text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* One live region for the run's progress + outcome — the bar is the only place a bulk write
          reports itself, and a partial failure must be heard, not inferred from the refreshed list. */}
      <p role="status" aria-live="polite" className="w-full font-mono text-sm">
        {bulk.running ? (
          <span className="text-slate-400">Updating {bulk.total} item{bulk.total === 1 ? "" : "s"}…</span>
        ) : bulk.total > 0 ? (
          <span className={bulk.failed > 0 ? "text-orange-300" : "text-emerald-300"}>
            {bulk.ok} of {bulk.total} updated{bulk.failed > 0 ? ` · ${bulk.failed} failed` : ""}
          </span>
        ) : null}
      </p>

      <ConfirmAction
        open={pending != null}
        busy={bulk.running}
        onCancel={() => setPending(null)}
        kicker="Bulk status change"
        tone={pending === "dismissed" ? "danger" : "default"}
        title={pending ? `Set ${count} item${count === 1 ? "" : "s"} to ${STATUS_LABEL[pending]}?` : ""}
        body={
          pending
            ? `This writes a status change (and a timeline event) on ${count} recommendation${count === 1 ? "" : "s"} across the fleet. ${
                pending === "done" || pending === "dismissed"
                  ? "They leave the active backlog; “Show done & dismissed” brings them back."
                  : "They stay in the active backlog."
              }`
            : ""
        }
        confirmLabel={pending ? `Set ${count} to ${STATUS_LABEL[pending]}` : ""}
        onConfirm={() => {
          const status = pending;
          setPending(null);
          if (status) onApply(status);
        }}
      />
    </div>
  );
}
