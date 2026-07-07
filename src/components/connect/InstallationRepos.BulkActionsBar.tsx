"use client";

import type { AppRepo } from "./installationRepoTypes";
import { SCHEDULES } from "./installationRepoTypes";

/** Bulk actions across the filtered set — watch many at once, or set one cadence for the
 *  whole watched set, instead of one click per repo. */
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
        {bulkBusy ? "Working…" : `Watch all (${filtered.filter((r) => !r.state?.watched).length})`}
      </button>
      <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
        Schedule watched
        <select
          value=""
          disabled={bulkBusy || watchedCount === 0}
          onChange={(e) => onScheduleWatched(e.target.value)}
          aria-label="Set autoscan cadence for all watched repos"
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-300 outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="">cadence…</option>
          {SCHEDULES.map((c) => (
            <option key={c} value={c}>
              {c}
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
