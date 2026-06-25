"use client";

// Compact in-place re-scan banner. When the user clicks "Re-test" on a report that's already on
// screen, ReportClient keeps that report mounted and renders this banner above it — so the report
// stays readable for the multi-minute re-scan instead of blanking to the full checklist. Mirrors the
// Loading time model (elapsed clock + forward-only percentage, shared from ReportClientStatus). On
// failure it flips to an inline alert with Retry/Dismiss, leaving the prior report intact.

import {
  displayProgressPct,
  progressHeadline,
  useElapsed,
  type Progress,
} from "@/components/report/ReportClientStatus";
import { formatDuration } from "@/components/report/scanEstimate";

export function RescanBanner({
  repo,
  progress,
  error,
  onRetry,
  onDismiss,
}: {
  repo: string;
  progress: Progress;
  /** Non-null once the re-scan failed: the report below stays, this row becomes a retry/dismiss alert. */
  error: string | null;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  // Hook order stays stable across the active/error branches — the clock just goes unused on error.
  const elapsedMs = useElapsed();

  if (error) {
    return (
      <div
        role="alert"
        className="animate-fade-up sticky top-16 z-10 mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-base text-danger-soft backdrop-blur"
      >
        <span aria-hidden>⚠</span>
        <span className="flex-1">Re-scan failed — your existing report is unchanged. {error}</span>
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring rounded-md border border-danger/40 px-3 py-1 text-sm font-medium transition hover:bg-danger/10"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="focus-ring rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const displayPct = displayProgressPct(progress, elapsedMs);
  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-fade-up sticky top-16 z-10 mb-6 rounded-xl border border-accent/30 bg-slate-950/80 px-4 py-3 backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base">
        {/* Spinner when motion is allowed; the elapsed clock carries the signal under reduced motion. */}
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 animate-spin text-accent motion-reduce:hidden"
          fill="none"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="4" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
        <span className="font-medium text-white">Re-scanning</span>
        <span className="font-mono text-sm text-slate-400">{repo}</span>
        <span aria-hidden className="text-slate-600">·</span>
        <span className="text-slate-300">{progressHeadline(progress)}</span>
        <span className="ml-auto font-mono text-sm tabular-nums text-slate-500">
          {formatDuration(elapsedMs)} · {displayPct}%
        </span>
      </div>
      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-valuenow={displayPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Re-scan progress"
      >
        <div
          className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
          style={{ width: `${Math.max(4, displayPct)}%` }}
        />
      </div>
      <p className="mt-1.5 text-sm text-slate-500">
        Your current report stays up — it’ll refresh when the re-scan finishes. This usually takes a
        few minutes.
      </p>
    </div>
  );
}
