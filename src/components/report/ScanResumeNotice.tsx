"use client";

// The RESTORED-WORK line for a scan this tab rejoined (repo-report-shell-tabs #4).
//
// Session-resume's resume-affordances rule: work that restores itself without being asked has to SAY it
// restored itself and carry a visible start-over exit. Without the line, a reloaded tab silently
// attached to a six-minute run is indistinguishable from a stuck one, and the user's only way out is to
// guess. Without the exit, a rejoin is a trap: the one case where the restored run is the wrong one (a
// repo that changed under it, a scan the user wanted to abandon) has no answer.
//
// It lives in its own file so ReportClientStatus stays under the 300-LOC cap.

import { formatDuration } from "@/components/report/scanEstimate";

export function ScanResumeNotice({
  repo,
  elapsedMs,
  onStartFresh,
}: {
  repo: string;
  /** Measured from the scan's REAL start (the resume anchor), not from this mount — a rejoin that
   *  restarted its clock at 0:00 would under-report exactly the wait it is explaining. */
  elapsedMs: number;
  onStartFresh?: () => void;
}) {
  return (
    <div
      data-testid="scan-resumed"
      className="animate-fade-up mt-5 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-left"
      role="status"
      aria-live="polite"
    >
      <p className="type-body-sm text-slate-300">
        Picked up the scan already running for <span className="font-mono text-white">{repo}</span>,{" "}
        <span className="tabular-nums">{formatDuration(elapsedMs)}</span> in. Reloading the page did not
        start it over.
      </p>
      {onStartFresh && (
        <button
          type="button"
          onClick={onStartFresh}
          className="mt-2 type-mono-sm text-accent underline decoration-dotted underline-offset-4 hover:text-white"
        >
          Start a fresh scan
        </button>
      )}
    </div>
  );
}
