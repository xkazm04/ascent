"use client";

// The run progress bar + currently-scanning caption + error/skipped notices for WarRoomHeader
// (LiveWarRoomHeader.tsx). Pulled out so the header's file stays under the 200-LOC cap
// (docs/ORG-TABS-REFACTOR.md).

import { shortName } from "@/components/org/shared/liveWarRoomShared";

export function HeaderProgress({
  running,
  pct,
  progress,
  error,
  skipped,
}: {
  running: boolean;
  pct: number;
  progress: { done: number; total: number; current: string };
  error: string | null;
  skipped: number;
}) {
  const safePct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  return (
    <>
      {running && (
        <div className="mt-4">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-label="Scan progress"
            aria-valuenow={safePct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${progress.done} of ${progress.total} repos scanned`}
          >
            {/* Floor of 3% so a just-started run still shows a sliver; ceiling of 100 so a
                credit-truncated run can't overrun the track (G6-08 — clamped at source in
                useLiveWarRoom, re-clamped here because `pct` is a prop). */}
            <div className="h-full rounded-full bg-accent transition-all motion-reduce:transition-none" style={{ width: `${Math.min(100, Math.max(3, safePct))}%` }} />
          </div>
          {progress.current && (
            // NOT a live region: the currently-scanning repo name changes on every landed result, so
            // announcing it floods a polite region during a full-fleet run (it never finishes reading).
            // The single run announcer is the coalesced "done/total repos" count above; this caption
            // is a visual-only status (matching the TV scanning stage, which likewise omits aria-live).
            <p className="mt-1 truncate font-mono text-sm text-slate-500" suppressHydrationWarning>
              scanning {shortName(progress.current)}…
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-base text-danger-soft">{error}</p>
      )}
      {skipped > 0 && (
        <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-base text-warn">
          {skipped} {skipped === 1 ? "repo" : "repos"} skipped, out of scan credits.
        </p>
      )}
    </>
  );
}
