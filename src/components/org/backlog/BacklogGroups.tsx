"use client";

// The backlog's grouped list body — the owner / due-date / projected-points Cards and their rows,
// plus the three distinct empty states. Extracted from BacklogPanel so that file stays under the
// 300-LOC cap once search/filter/bulk-select landed (G7-12). Behavior of the grouping itself is
// unchanged; the only addition is the per-row selection checkbox.

import { Card } from "@/components/org/shared/ui";
import type { BacklogItem, BacklogDueGroup, OrgBacklog } from "@/lib/db";
import { OwnerHeader } from "@/components/org/backlog/BacklogSummary";
import { BacklogItemRow, type BacklogRowState } from "@/components/org/backlog/BacklogItemRow";
import type { PatchOutcome } from "@/components/org/shared/backlogShared";
// Impact-word tiebreak ranking for the "Projected points" cross-repo sort (canonical map).
import { IMPACT_RANK } from "@/lib/scoring/impact";

export type BacklogView = "owner" | "due" | "points";

interface Group {
  key: string;
  header: React.ReactNode;
  items: BacklogItem[];
}

/** Build the display groups for a view. Kept next to the renderer (it produces JSX headers) but with
 *  no state of its own, so the grouping rules stay one readable block. */
function buildGroups(backlog: OrgBacklog, view: BacklogView): Group[] {
  if (view === "owner") {
    return backlog.byOwner.map((g) => ({
      key: g.login ?? "__unassigned",
      header: <OwnerHeader group={g} />,
      items: g.items,
    }));
  }
  if (view === "due") {
    return backlog.byDue.map((g: BacklogDueGroup) => ({
      key: g.bucket,
      header: (
        <span className={`text-base font-semibold ${g.bucket === "overdue" ? "text-orange-300" : "text-white"}`}>
          {g.label} <span className="font-mono text-sm text-slate-500">· {g.items.length}</span>
        </span>
      ),
      items: g.items,
    }));
  }
  return [
    {
      key: "__points",
      header: (
        <span className="text-base font-semibold text-white">
          Highest projected gain first{" "}
          <span className="font-mono text-sm text-slate-500">· engine points if the gap is fully closed</span>
        </span>
      ),
      // "Projected points" is a flat cross-repo ranking on the engine-true ROI each item carries
      // (projectedPoints — overall-score upside of closing the gap), so cross-repo leverage the
      // per-repo report can't show sorts to the top. Items without a projection (pre-dimension scans)
      // sink below scored ones; impact words break ties. Built lazily here so the cross-repo sort only
      // runs when this view is actually selected.
      items: backlog.byOwner
        .flatMap((g) => g.items)
        .sort(
          (a, b) =>
            (b.projectedPoints ?? -1) - (a.projectedPoints ?? -1) ||
            (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0) ||
            b.lastActivityAt.localeCompare(a.lastActivityAt),
        ),
    },
  ];
}

export function BacklogGroups({
  slug,
  backlog,
  view,
  showClosed,
  closedCount,
  filtered,
  onClearFilter,
  savingIds,
  errors,
  rowStates,
  onRowState,
  onPatch,
  onEditField,
  selected,
  onToggleSelect,
}: {
  slug: string;
  /** Already filtered — this component never re-applies the filter. */
  backlog: OrgBacklog;
  view: BacklogView;
  showClosed: boolean;
  closedCount: number;
  /** A filter/search is narrowing the list, so "nothing here" means "nothing MATCHED". */
  filtered: boolean;
  onClearFilter: () => void;
  savingIds: Set<string>;
  errors: Record<string, string>;
  rowStates: Record<string, BacklogRowState>;
  onRowState: (id: string, patch: BacklogRowState) => void;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<PatchOutcome>;
  onEditField: (focusKey: string) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const groups = buildGroups(backlog, view);

  if (groups.length === 0) {
    return (
      <Card>
        {filtered ? (
          <>
            <p className="text-base text-slate-500">No backlog items match this search or filter.</p>
            <button onClick={onClearFilter} className="focus-ring mt-1 rounded font-mono text-sm text-accent hover:text-white">
              clear filters
            </button>
          </>
        ) : (
          <>
            <p className="text-base text-slate-500">
              {showClosed
                ? "No recommendations at all — nothing has been tracked for this scope yet."
                : "Nothing active in the backlog — every recommendation is done or dismissed. 🎉"}
            </p>
            {/* Never a terminal dead end: name the route to the closed items even from the empty state. */}
            {!showClosed && closedCount > 0 && (
              <p className="mt-1 text-sm text-slate-500">
                Use “Show done &amp; dismissed” above to review or restore the {closedCount} closed item
                {closedCount === 1 ? "" : "s"}.
              </p>
            )}
          </>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g.key}>
          <div className="mb-3">{g.header}</div>
          <div className="space-y-3">
            {g.items.map((item) => (
              <div key={item.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => onToggleSelect(item.id)}
                  aria-label={`Select “${item.title}” (${item.repo}) for a bulk action`}
                  className="mt-5 shrink-0 accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <BacklogItemRow
                    org={slug}
                    item={item}
                    assignees={backlog.assignees}
                    saving={savingIds.has(item.id)}
                    error={errors[item.id]}
                    state={rowStates[item.id]}
                    onState={(patch) => onRowState(item.id, patch)}
                    onPatch={onPatch}
                    onEditField={onEditField}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
