"use client";

import type { AppRepo } from "./installationRepoTypes";
import { SCHEDULES, scheduleLabel } from "./installationRepoTypes";

/** Bulk actions — watch many at once, or set one cadence for the whole watched set, instead of
 *  one click per repo. The two controls have DIFFERENT scopes and the labels must say so:
 *  "Watch all" acts on the currently FILTERED (shown) rows, while the bulk schedule acts on
 *  EVERY watched repo in the org (the schedule route's no-fullName body), ignoring the active
 *  filter — each scheduled run is billable, so under-stating that scope silently over-schedules. */
export function BulkActionsBar({
  filtered,
  watchedCount,
  bulkBusy,
  bulkMsg,
  onWatchAllFiltered,
  onScheduleWatched,
}: {
  filtered: AppRepo[];
  watchedCount: number;
  bulkBusy: boolean;
  bulkMsg: { kind: "note" | "error"; text: string } | null;
  onWatchAllFiltered: () => void;
  onScheduleWatched: (schedule: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        onClick={onWatchAllFiltered}
        disabled={bulkBusy || filtered.every((r) => r.state?.watched)}
        className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 font-mono text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
      >
        {bulkBusy ? "Working…" : `Watch all ${filtered.filter((r) => !r.state?.watched).length} shown`}
      </button>
      <label
        className="flex items-center gap-1.5 font-mono text-sm text-slate-500"
        title="Applies to every watched repo in this org — including repos outside the current filter."
      >
        {`Schedule all ${watchedCount} watched`}
        <select
          value=""
          disabled={bulkBusy || watchedCount === 0}
          onChange={(e) => onScheduleWatched(e.target.value)}
          aria-label={`Set autoscan cadence for all ${watchedCount} watched repos in this org, including repos outside the current filter`}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-300 outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="">cadence…</option>
          {SCHEDULES.map((c) => (
            <option key={c} value={c}>
              {scheduleLabel(c)}
            </option>
          ))}
        </select>
      </label>
      {bulkMsg && (
        <span
          role={bulkMsg.kind === "error" ? "alert" : "status"}
          aria-live={bulkMsg.kind === "error" ? "assertive" : "polite"}
          className={`font-mono text-sm ${bulkMsg.kind === "error" ? "text-danger" : "text-slate-500"}`}
        >
          {bulkMsg.text}
        </span>
      )}
    </div>
  );
}
