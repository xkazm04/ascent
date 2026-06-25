"use client";

import { useEffect, useState } from "react";
import type { ScanReport } from "@/lib/types";
import { freshness } from "@/lib/ui";
import { pillClass } from "./pill";

/**
 * Scan-freshness control: "Scanned 4m ago · Re-test". The relative time advances on a 30s
 * ticker (no reload). Re-test re-runs the scan — cheap when the repo is unchanged (a conditional
 * request returns a free 304 and the persisted scan is served), a full re-score when it moved.
 * In the live scan view `onRetest` re-triggers the in-page SSE run; on a server-rendered pinned
 * permalink (no callback) it links to the live scanner with `fresh=1` to force a re-check.
 */
export function FreshnessControl({
  report,
  onRetest,
  rescanning = false,
}: {
  report: ScanReport;
  onRetest?: () => void;
  /** A re-test is already in flight (the live view keeps the report up + shows a banner) — disable
   *  the control so a second click can't stack another run. */
  rescanning?: boolean;
}) {
  // Re-render every 30s so "just now" → "1m ago" → "2m ago" stays honest without a reload.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const retestHref = `/report?repo=${encodeURIComponent(report.repo.url)}&fresh=1`;
  const retestClass = pillClass();
  const refreshIcon = (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none">
      <path
        d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5V5h-2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <div className="flex items-center gap-2 font-mono text-sm text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none">
          <path
            d="M8 4v4l2.5 1.5M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Scanned <span className="text-slate-300">{freshness(report.scannedAt)}</span>
      </span>
      {onRetest ? (
        <button
          type="button"
          onClick={onRetest}
          disabled={rescanning}
          aria-disabled={rescanning || undefined}
          className={`${retestClass} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {refreshIcon}
          {rescanning ? "Re-scanning…" : "Re-test"}
        </button>
      ) : (
        <a href={retestHref} className={retestClass}>
          {refreshIcon}
          Re-test
        </a>
      )}
    </div>
  );
}
