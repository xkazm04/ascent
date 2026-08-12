"use client";

import type { OrgBacklog } from "@/lib/db";
import { SummaryStrip } from "@/components/org/plan/backlog/BacklogSummary";
import { BacklogUndoBar, BacklogViewControls } from "@/components/org/plan/backlog/BacklogPanelControls";
import { BacklogFilters } from "@/components/org/plan/backlog/BacklogFilters";
import { BacklogBulkBar } from "@/components/org/plan/backlog/BacklogBulkBar";
import { BacklogGroups } from "@/components/org/plan/backlog/BacklogGroups";
import { backlogItemCount, filterIsActive, EMPTY_BACKLOG_FILTER } from "@/components/org/plan/backlog/backlogFilter";
import { useBacklogPanel, BACKLOG_MAX_BULK } from "@/components/org/plan/backlog/useBacklogPanel";

/**
 * The org-wide recommendation backlog: a stat strip, a By owner / By due date toggle, and inline
 * controls to set each item's status, owner, and due date. Every change PATCHes the recommendation
 * (recording an activity-timeline event) and re-reads the backlog so the groupings and counts stay
 * consistent. Each item exposes its history on demand. State/handlers live in `useBacklogPanel`
 * (200-LOC cap).
 */
export function BacklogPanel({
  slug,
  initial,
  segmentId = null,
  techGroupId = null,
}: {
  slug: string;
  initial: OrgBacklog;
  /** The page's resolved segment/tech-group scope — threaded into every refresh so a post-edit
   *  re-read stays on the filtered view instead of snapping back to the whole org (backlog #2 07-16). */
  segmentId?: string | null;
  techGroupId?: string | null;
}) {
  const p = useBacklogPanel({ slug, initial, segmentId, techGroupId });

  return (
    // data-tour: the onboarding companion's "resolve one gap" spotlight (GETTING_STARTED_ANCHORS).
    <div data-tour="backlog-recs" className="space-y-5">
      <SummaryStrip b={p.backlog} />

      <BacklogViewControls
        view={p.view}
        onView={p.setView}
        showClosed={p.showClosed}
        onToggleClosed={() => p.setShowClosed((v) => !v)}
        closedCount={p.backlog.done + p.backlog.dismissed}
        exportHref={p.exportHref}
      />

      <BacklogFilters
        filter={p.filter}
        onFilter={p.applyFilter}
        ownerOptions={p.ownerOptions}
        shown={p.shownCount}
        total={backlogItemCount(p.backlog)}
      />

      {/* The bar outlives the selection on purpose: a run clears the selection, and unmounting the bar
          with it would take the "N of M updated · K failed" report down with it — the only place a
          bulk write reports itself. It stays until explicitly cleared. */}
      {(p.selected.size > 0 || p.bulk.running || p.bulk.total > 0) && (
        <BacklogBulkBar
          count={p.selected.size}
          shownCount={p.shownCount}
          bulk={p.bulk}
          onSelectAll={() => p.setSelected(new Set(p.shownIds.slice(0, BACKLOG_MAX_BULK)))}
          onClear={() => {
            p.setSelected(new Set());
            p.resetBulk();
          }}
          onApply={(status) => void p.runStatus(status)}
        />
      )}

      {p.undo && (
        <BacklogUndoBar undo={p.undo} busy={p.undoBusy} onUndo={() => void p.runUndo()} onDismiss={() => p.setUndo(null)} />
      )}

      <BacklogGroups
        slug={slug}
        backlog={p.shownBacklog}
        view={p.view}
        showClosed={p.showClosed}
        closedCount={p.backlog.done + p.backlog.dismissed}
        filtered={filterIsActive(p.filter)}
        onClearFilter={() => p.applyFilter(EMPTY_BACKLOG_FILTER)}
        savingIds={p.savingIds}
        errors={p.errors}
        rowStates={p.rowStates}
        onRowState={p.setRowState}
        onPatch={p.patch}
        onEditField={p.onEditField}
        selected={p.selected}
        onToggleSelect={p.toggleSelect}
      />
    </div>
  );
}
