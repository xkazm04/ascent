"use client";

// The strip's one action: rescan exactly the carried, watched, unqueued repos (periodCoverageModel.ts)
// through the existing bulk-scan hook. Nothing about money or access moves here: the route keeps
// requireOrgAccess, the per-repo credit reservation and the watchlist intersection, and a run that
// outlasts its budget lands on the durable queue the hook already follows. The hook refreshes the
// router when the stream ends, so the strip re-derives from the new rollup.

import { useRef, useState } from "react";
import { useOrgScanButton } from "../scan/useOrgScanButton";
import { ScanRunRoster } from "../scan/ScanRunRoster";

export function PeriodCoverageRescan({ slug, repos }: { slug: string; repos: string[] }) {
  const { p, run, retryFailed } = useOrgScanButton(slug, repos.length);
  // The hook refuses a click while `p.running`, but that flag lands a render later: a double click
  // inside one frame would start two billable runs. This latch closes that gap.
  const inFlight = useRef(false);
  const [started, setStarted] = useState(false);
  const busy = p.running || started;

  function onClick() {
    if (inFlight.current || p.running || repos.length === 0) return;
    inFlight.current = true;
    setStarted(true);
    void Promise.resolve(run({ repos })).finally(() => {
      inFlight.current = false;
      setStarted(false);
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        aria-disabled={busy || undefined}
        className={`focus-ring rounded-md border border-slate-700 px-2 py-1 type-mono-sm text-slate-200 transition ${
          busy ? "cursor-not-allowed opacity-50" : "hover:border-accent hover:text-white"
        }`}
      >
        {p.running ? (p.total ? `Rescanning ${p.done}/${p.total}…` : "Rescanning…") : `Rescan ${repos.length}`}
      </button>
      <span role="status" aria-live="polite" aria-atomic="true" className="type-body-sm">
        {!p.running && p.queued && !p.error && p.queued.pending > 0 && (
          <span className="text-warn">
            {p.queued.pending} queued, {p.queued.stopped ? "last count; reload to check." : "finishing in the background."}
          </span>
        )}
        {p.error && <span className="text-danger">{p.error}</span>}
      </span>
      {!p.running && !p.error && <ScanRunRoster org={slug} roster={p.roster} onRetry={() => void retryFailed?.()} busy={busy} />}
    </span>
  );
}
