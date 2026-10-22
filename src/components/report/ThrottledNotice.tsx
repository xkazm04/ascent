"use client";

// A throttled scan: the per-minute limiter refused it, and its retry-after is honest, so this is a
// countdown that resumes itself rather than an error with a Retry that re-trips the same window.
// Two scales: `page` (a first scan, nothing on screen yet) and `inline` (inside the re-scan alert,
// with the report still mounted underneath). The schedule and its bounds live in scanThrottleModel;
// the timer in useThrottleResume. No em dashes in this copy (house rule; pinned in the dom test).

import { EmptyState } from "@/components/EmptyState";
import { CTA_PRIMARY } from "@/lib/ui";
import { throttleCopy, type Throttle } from "@/components/report/scanThrottleModel";
import { useThrottleResume, type ThrottleResume } from "@/components/report/useThrottleResume";

function statusLine({ seconds, ready, mode }: ThrottleResume): string {
  if (mode === "paused") {
    return ready
      ? "Paused while this tab is in the background. It resumes when you come back."
      : `Paused while this tab is in the background. The window clears in ${seconds}s.`;
  }
  if (mode === "manual") {
    return ready ? "The window has cleared. Resume when you are ready." : `The window clears in ${seconds}s.`;
  }
  return ready ? "Resuming now." : `Resuming on its own in ${seconds}s.`;
}

const BUTTON_PAGE = `${CTA_PRIMARY} disabled:cursor-not-allowed disabled:opacity-50`;
const BUTTON_INLINE =
  "focus-ring shrink-0 rounded-md border border-warn/40 px-3 py-1 type-body-sm font-medium transition hover:bg-warn/10 disabled:cursor-not-allowed disabled:opacity-50";

export function ThrottledNotice({
  throttle,
  autoUsed,
  onResume,
  variant = "page",
  rng,
}: {
  throttle: Throttle;
  /** Automatic resumes already spent this visit (useReportScan's `autoResumes`). */
  autoUsed: number;
  /** `true` when the countdown fired it, `false` for the hand-pressed "Resume now". */
  onResume: (auto: boolean) => void;
  variant?: "page" | "inline";
  /** Injected jitter source (tests); defaults to Math.random. */
  rng?: () => number;
}) {
  const timer = useThrottleResume(throttle, autoUsed, onResume, rng);
  const copy = throttleCopy(throttle);
  const line = statusLine(timer);
  const button = (
    <button
      type="button"
      disabled={!timer.ready}
      onClick={() => onResume(false)}
      className={variant === "page" ? BUTTON_PAGE : BUTTON_INLINE}
    >
      Resume now
    </button>
  );

  if (variant === "inline") {
    return (
      <span className="flex flex-1 flex-wrap items-center gap-3" data-throttle-scope={throttle.scope}>
        <span className="flex-1">
          <span className="font-medium">{copy.title}.</span> {copy.body}{" "}
          <span role="timer" aria-live="off" className="type-mono-sm tabular-nums">
            {line}
          </span>
        </span>
        {button}
      </span>
    );
  }

  return (
    <EmptyState
      icon="⏳"
      title={copy.title}
      body={
        <>
          {copy.body}{" "}
          <span role="timer" aria-live="off" className="type-mono-sm tabular-nums text-slate-300">
            {line}
          </span>
        </>
      }
      actions={[{ label: "← Back home", href: "/" }]}
    >
      {button}
    </EmptyState>
  );
}
