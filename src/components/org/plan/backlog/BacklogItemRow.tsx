"use client";

import { ConfirmAction, draftPrConfirm } from "@/components/ConfirmAction";
import { type RecEvent } from "@/lib/types";
import type { BacklogItem } from "@/lib/db";
import { OVERDUE_ACCENT, statusAccent, type PatchOutcome } from "@/components/org/shared/backlogShared";
import { BacklogRowControls } from "@/components/org/plan/backlog/BacklogItemRowControls";
import { DueChip } from "@/components/org/plan/backlog/BacklogItemRowDue";
import { BacklogRowExplore } from "@/components/org/plan/backlog/BacklogItemRowExplore";
import { BacklogRowHistory } from "@/components/org/plan/backlog/BacklogItemRowHistory";
import { useBacklogItemRow } from "@/components/org/plan/backlog/useBacklogItemRow";

/**
 * Volatile per-row interaction state that must survive a regroup. The backlog re-parents rows into a
 * different owner/due `<Card>` on every edit, which unmounts+remounts the row; keeping this state in
 * the row would wipe the just-opened PR link, the expanded history and the promote flag. So it is
 * lifted into BacklogPanel (keyed by item id) and passed back in — see backlog-management #2.
 */
export interface BacklogRowState {
  /** "error" is distinct from [] — a failed fetch must never render as the confident
   *  "No changes recorded yet." empty-copy (backlog-management 07-16 #3). */
  history?: RecEvent[] | "loading" | "error" | null;
  prResult?: { url: string; reused: boolean } | null;
  prError?: string | null;
  promoted?: boolean;
}

/** One backlog row. State/handlers live in `useBacklogItemRow` (200-LOC cap). */
export function BacklogItemRow({
  org,
  item,
  assignees,
  saving,
  error,
  state,
  onState,
  onPatch,
  onEditField,
}: {
  org: string;
  item: BacklogItem;
  assignees: string[];
  saving: boolean;
  error?: string;
  /** Lifted per-row state (PR result, history, promote flag) that survives a regroup remount. */
  state?: BacklogRowState;
  /** Merge a patch into this row's lifted state in the parent. */
  onState: (patch: BacklogRowState) => void;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<PatchOutcome>;
  /** Tell the parent which inline control is being edited (`${id}:status|owner|due`) so it can
   *  restore keyboard focus after the edit re-groups this row into a different Card and remounts it,
   *  which otherwise drops focus to <body> (backlog-management #3). */
  onEditField: (focusKey: string) => void;
}) {
  const row = useBacklogItemRow({ org, item, assignees, state, onState, onPatch, onEditField });

  return (
    <div
      aria-busy={saving}
      className="rounded-xl border bg-slate-900/40 p-4"
      style={{ borderLeftWidth: 3, borderLeftColor: item.overdue ? OVERDUE_ACCENT : statusAccent(row.shown.status) }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {/* min-w-0 on this flex item (above) lets the block title truncate: a long unbroken title
              now ellipsises to one line instead of forcing the row wide; full text on hover. */}
          <div className="truncate font-medium text-white" title={item.title}>{item.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-sm text-slate-500">
            <span className="text-slate-400">{item.repo}</span>
            <span>· {item.dimId} {item.dimLabel}</span>
            <span>· impact {item.impact}</span>
            <span>· effort {item.effort}</span>
            {/* Engine-true ROI (same math as the report's payoff chip) — the glass-box upgrade
                over the qualitative impact/effort words. Hidden when the scan predates persisted
                dimensions (null) or the gap moves nothing (0). */}
            {item.projectedPoints != null && item.projectedPoints > 0 && (
              <span
                title="Engine projection: overall-score points this repo gains if this gap is fully closed"
                className="rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent"
              >
                ↑ +{item.projectedPoints} pts{item.unlocks ? ` · unlocks ${item.unlocks}` : ""}
              </span>
            )}
          </div>
        </div>
        {/* Always rendered — an undated item gets an explicit "no due date" affordance rather than an
            empty slot that reads as a rendering bug (G6-28). */}
        <DueChip item={item} />
      </div>

      <BacklogRowControls
        item={item}
        shown={row.shown}
        saving={saving}
        options={row.options}
        practice={row.practice}
        prBusy={row.prBusy}
        promoteBusy={row.promoteBusy}
        promoted={row.promoted}
        historyOpen={!!row.history}
        onPatchField={row.patchField}
        onOpenPr={() => row.setConfirmingPr(true)}
        onPromote={row.promoteToInitiative}
        onToggleHistory={row.toggleHistory}
      />

      {/* One polite live region for the row's async outcomes (save error / PR error / PR link): on this
          screen the error message is the only signal an edit was rejected — the control just visually
          reverts — so AT must hear these appear (backlog-management 07-16 #5). */}
      <div role="status" aria-live="polite">
        {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
        {row.prError && <p className="mt-2 text-sm text-orange-300">{row.prError}</p>}
        {row.prResult && (
          <p className="mt-2 text-sm text-emerald-300">
            {row.prResult.reused ? "Existing draft PR: " : "Draft PR opened: "}
            <a href={row.prResult.url} target="_blank" rel="noreferrer" className="underline hover:text-white">
              {row.prResult.url}
            </a>
          </p>
        )}
      </div>

      <BacklogRowExplore item={item} />

      {row.history && <BacklogRowHistory id={`history-${item.id}`} history={row.history} onRetry={() => void row.loadHistory()} />}

      {/* Always mounted, toggled by `open`, so Modal's portal is armed before the Cancel-focus effect runs. */}
      <ConfirmAction
        open={row.confirmingPr}
        busy={row.prBusy}
        onCancel={() => row.setConfirmingPr(false)}
        onConfirm={() => {
          row.setConfirmingPr(false);
          void row.openDraftPr();
        }}
        {...(row.practice
          ? draftPrConfirm(item.repo, `the "${row.practice.label}" starter`)
          : { title: "", body: "", confirmLabel: "", tone: "default" as const })}
      />
    </div>
  );
}
