"use client";

// One row of the drawer's list — a setup TASK (server-derived checkmark) or a teach step in the
// teaching rail. Presentation only: the row reports a click, the drawer decides what a click means.
//
// The `skipped`/`n/a` treatment is deliberately the one the teach list already used, because it says
// the same thing in both worlds: "this is real, it just isn't yours to do here." An unavailable task
// is rendered — never hidden — so the member can see the shape of the whole flow and why a step is
// out of reach, rather than wondering what a shorter list means.

import type { DrawerItem } from "./tasks";

export type RowState = "active" | "done" | "pending" | "unavailable";

export function rowState(item: DrawerItem, active: boolean): RowState {
  if (!item.available) return "unavailable";
  if (active) return "active";
  return item.done ? "done" : "pending";
}

export function TourTaskRow({ item, state, onSelect }: { item: DrawerItem; state: RowState; onSelect: () => void }) {
  const muted = state === "pending" || state === "unavailable";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={state === "unavailable"}
        aria-current={state === "active" ? "step" : undefined}
        title={item.unavailableReason}
        className={`focus-ring flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
          state === "active" ? "border-accent bg-accent/10" : "border-transparent hover:border-slate-700 hover:bg-white/5"
        } ${state === "unavailable" ? "cursor-default opacity-50 hover:border-transparent hover:bg-transparent" : ""}`}
      >
        <Marker state={state} />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${muted ? "text-slate-400" : "text-white"}`}>{item.title}</span>
          {state === "unavailable" && item.unavailableReason && (
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{item.unavailableReason}</span>
          )}
          {state !== "unavailable" && item.detail && (
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{item.detail}</span>
          )}
        </span>
        {state === "unavailable" && (
          <span className="font-mono text-xs uppercase tracking-widest text-slate-500">n/a</span>
        )}
      </button>
    </li>
  );
}

export function Marker({ state }: { state: RowState }) {
  if (state === "unavailable") {
    return <span aria-hidden className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-dashed border-slate-700" />;
  }
  if (state === "done") {
    return (
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-xs text-on-accent">
        ✓
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border ${
        state === "active" ? "border-accent motion-safe:animate-pulse" : "border-slate-600"
      }`}
    />
  );
}

/** done/total over available tasks, as a bar + a count. The companion's only measure of "how far in". */
export function TourProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Setup progress"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
