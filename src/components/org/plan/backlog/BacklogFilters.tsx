"use client";

// The backlog's search + filter row (G7-12): a full-text box, status chips, and an owner picker.
// Purely a control surface — every matching decision lives in the pure `backlogFilter` module.
//
// Picking a CLOSED status chip (Done / Dismissed) implicitly turns "show done & dismissed" on, because
// those rows aren't in the default payload at all. The chip says so in its title, and the panel does
// the actual toggling — the filter builds on the recovery view rather than around it.

import { STATUS_LABEL } from "@/components/org/shared/backlogShared";
import type { RecStatus } from "@/lib/types";
import {
  CLOSED_STATUSES,
  FILTERABLE_STATUSES,
  UNASSIGNED,
  filterIsActive,
  type BacklogFilter,
} from "@/components/org/plan/backlog/backlogFilter";

const CHIP = "rounded-lg border px-2.5 py-1 text-sm font-medium transition";
const ON = "border-accent/50 bg-accent/10 text-white";
const OFF = "border-slate-700 text-slate-400 hover:text-white";

export function BacklogFilters({
  filter,
  onFilter,
  ownerOptions,
  shown,
  total,
}: {
  filter: BacklogFilter;
  onFilter: (f: BacklogFilter) => void;
  ownerOptions: { logins: string[]; hasUnassigned: boolean };
  /** Rows on screen after filtering. */
  shown: number;
  /** Rows the current fetch carried, before filtering. */
  total: number;
}) {
  const active = filterIsActive(filter);

  function toggleStatus(s: string) {
    const next = filter.statuses.includes(s)
      ? filter.statuses.filter((x) => x !== s)
      : [...filter.statuses, s];
    onFilter({ ...filter, statuses: next });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* type="search" gives the native clear affordance; the explicit label keeps it announced. */}
        <input
          type="search"
          value={filter.q}
          onChange={(e) => onFilter({ ...filter, q: e.target.value })}
          aria-label="Search the backlog"
          placeholder="Search title, repo, dimension, owner…"
          className="min-w-[14rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
        />
        {/* A <span>, not a wrapping <label>: a label reading "Owner" would give this control the same
            accessible name as every ROW's owner select, making the two indistinguishable to AT (and to
            a by-label query). The aria-label below is the single source of its name. */}
        <div className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          <span aria-hidden>Owner</span>
          <select
            value={filter.owner ?? ""}
            onChange={(e) => onFilter({ ...filter, owner: e.target.value === "" ? null : e.target.value })}
            aria-label="Filter by owner"
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
          >
            <option value="">Anyone</option>
            {ownerOptions.hasUnassigned && <option value={UNASSIGNED}>Unassigned</option>}
            {ownerOptions.logins.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-sm uppercase tracking-widest text-slate-500">Status</span>
          {FILTERABLE_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              aria-pressed={filter.statuses.includes(s)}
              title={
                CLOSED_STATUSES.includes(s)
                  ? `${STATUS_LABEL[s as RecStatus]} items are only loaded with “Show done & dismissed” — picking this turns it on`
                  : `Show only ${STATUS_LABEL[s as RecStatus]} items`
              }
              className={`${CHIP} ${filter.statuses.includes(s) ? ON : OFF}`}
            >
              {STATUS_LABEL[s as RecStatus]}
            </button>
          ))}
        </div>

        {active && (
          <>
            {/* Say what the filter did to the list — a silent narrowing reads as missing data. */}
            <span aria-live="polite" className="font-mono text-sm text-slate-500">
              {shown} of {total} shown
            </span>
            <button
              onClick={() => onFilter({ q: "", statuses: [], owner: null })}
              className="focus-ring rounded font-mono text-sm text-accent hover:text-white"
            >
              clear filters
            </button>
          </>
        )}
      </div>
    </div>
  );
}
