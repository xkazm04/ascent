"use client";

// actionable-toasts: the fleet list is where the doors open. "Unwatch" acts immediately and raises the
// undo toast — a generous, attention-paused window whose expiry COMMITS the removal (deferred delete,
// reliable because expiry is state). "Fail rescan" raises an error toast with one verb, Retry; a
// "background recovery" in between makes that Retry stale, and the handler re-checks before acting:
// a stale retry degrades to a quiet acknowledgment, never a second failure toast.

import type { Desk } from "./useDesk";
import { UNDO_WINDOW_MS } from "./fixtures";
import { BTN, Readout, Region } from "./sceneParts";

export function ActionRegion({ desk }: { desk: Desk }) {
  const { state, dispatch } = desk;
  const target = state.fleet[2]?.name ?? "";
  const rescan = state.rescans[target] ?? "idle";
  const undoLive = state.queue.toasts.find((t) => t.kind === "repo-unwatched");
  return (
    <Region technique="actionable-toasts" title="A toast is a door" note={`One verb, landing at the remedy; dismiss is a separate target. The undo window is ${UNDO_WINDOW_MS / 1000}s and pauses under attention.`}>
      <ul className="space-y-1" aria-label="Watched repositories" data-fleet>
        {state.fleet.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-2 rounded-md border border-divider px-2 py-1" data-repo={r.name} data-status={r.status}>
            <span className={`type-caption ${r.status === "removed" ? "text-slate-600 line-through" : "text-slate-300"}`}>{r.name}</span>
            <span className="flex items-center gap-2">
              <span className="type-micro text-slate-500">{r.status === "pending-removal" ? "unwatched — undo is live" : r.status}</span>
              <button type="button" className={BTN} disabled={r.status !== "watched"} onClick={() => dispatch({ type: "fleet:unwatch", name: r.name })} aria-label={`Unwatch ${r.name}`}>
                unwatch
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 type-micro text-slate-500" data-undo={undoLive ? "live" : "none"}>
        {undoLive ? `Undo window open: ${Math.ceil((undoLive.remainingMs ?? 0) / 1000)}s left${undoLive.attended ? " (paused — you are on it)" : ""}. It ends visibly: the toast leaves and the removal commits.` : "No undo window open. Removal is deferred behind the window, committed on expiry — not compensated after."}
      </p>

      <div className="mt-3 rounded-lg border border-divider p-2">
        <p className="type-caption text-slate-300">
          Retry race on <span className="font-mono">{target}</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={() => dispatch({ type: "rescan:fail", name: target })} disabled={rescan === "failed"}>
            fail rescan
          </button>
          <button type="button" className={BTN} onClick={() => dispatch({ type: "rescan:recover", name: target })} disabled={rescan !== "failed"}>
            background recovery
          </button>
        </div>
        <div className="mt-2 space-y-1">
          <Readout label="world" value={<span data-rescan={rescan}>{rescan}</span>} tone={rescan === "failed" ? "text-danger-soft" : "text-slate-200"} />
          <Readout label="retry handler" value={rescan === "failed" ? "would queue a rescan" : rescan === "recovered" ? "stale → quiet no-op" : "nothing to retry"} />
        </div>
        <p className="mt-2 type-micro text-slate-500">
          The Retry on the toast carries its full address ({target}) and re-checks the world before acting. The same handler sits on the ledger entry — the toast is the fast path, never the only one.
        </p>
      </div>
    </Region>
  );
}
