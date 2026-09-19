"use client";

import { useEffect, useState } from "react";
import type { ScanReport } from "@/lib/types";
import { freshness, reportPermalink } from "@/lib/ui";
import { ConfirmAction, retestConfirm } from "@/components/ConfirmAction";
import { pillClass } from "./pill";

/**
 * Scan-freshness control: "Scanned 4m ago · Re-test". The relative time advances on a 30s
 * ticker (no reload). Re-test re-runs the scan — cheap when the repo is unchanged (a conditional
 * request returns a free 304 and the persisted scan is served), a full re-score when it moved.
 * In the live scan view `onRetest` re-triggers the in-page SSE run; on a server-rendered pinned
 * permalink (no callback) it stays on `/report/{owner}/{repo}` with `fresh=1` so Re-test does not
 * bounce to the `/report?repo=` job URL.
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

  // The in-page "Re-test" spends a weekly scan slot on one click — gate it behind a confirm that names
  // the repo. (Only the `onRetest` button path is metered here; the permalink `<a>` navigates to the
  // scanner, which owns its own flow.)
  const [confirming, setConfirming] = useState(false);

  // Stay on the durable permalink (`/report/{owner}/{repo}[@{sha}]`) and add `fresh=1` only.
  // Bouncing to `/report?repo=` dropped the shareable URL; omitting `@headSha` used to abandon
  // a pinned commit and rescan HEAD. `fresh=1` still forces a re-check of that exact sha.
  const retestHref = `${reportPermalink(`${report.repo.owner}/${report.repo.name}`, report.repo.headSha)}?fresh=1`;
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
    <>
    <div className="flex items-center gap-2 type-mono-sm text-slate-500">
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
          onClick={() => setConfirming(true)}
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

    {/* Always mounted, toggled by `open`, so Modal's portal is armed before the Cancel-focus effect runs. */}
    <ConfirmAction
      open={confirming}
      busy={rescanning}
      onCancel={() => setConfirming(false)}
      onConfirm={() => {
        setConfirming(false);
        onRetest?.();
      }}
      {...retestConfirm(`${report.repo.owner}/${report.repo.name}`)}
    />
    </>
  );
}
