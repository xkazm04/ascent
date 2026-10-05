"use client";

import { useEffect, useState } from "react";
import type { ScanReport } from "@/lib/types";
import { freshness, reportPermalink } from "@/lib/ui";
import { ConfirmAction, retestConfirm } from "@/components/ConfirmAction";
import { pillClass } from "./pill";
import { reportFreshnessState, type ReportFreshnessState } from "./reportFreshness";

/** Tier → tone for the age itself. `current` keeps today's muted slate; every other state drops it,
 *  because a state that renders in the fresh costume is the thing this control existed to fix. */
const AGE_TONE: Record<ReportFreshnessState["tier"], string> = {
  current: "text-slate-300",
  aging: "text-amber-200",
  stale: "text-amber-300",
  unknown: "text-amber-300",
};

/**
 * Scan-freshness control: "Scanned 4m ago · Re-test". The relative time advances on a 30s
 * ticker (no reload). Re-test re-runs the scan — cheap when the repo is unchanged (a conditional
 * request returns a free 304 and the persisted scan is served), a full re-score when it moved.
 * In the live scan view `onRetest` re-triggers the in-page SSE run; on a server-rendered pinned
 * permalink (no callback) it stays on `/report/{owner}/{repo}` with `fresh=1` so Re-test does not
 * bounce to the `/report?repo=` job URL.
 *
 * FRESHNESS IS A STATE, NOT A TIMESTAMP. With `freshnessWindowMs` threaded from the server, the row
 * states its tier and the reason for it (see ./reportFreshness), adds the drift clause when the
 * remembered head has moved off the scored commit, and PROMOTES this same Re-test control instead of
 * growing a second competing button. Without the props (the live-scan path, which has no server
 * pass) it renders exactly the one muted line it always did.
 */
export function FreshnessControl({
  report,
  onRetest,
  rescanning = false,
  lastSeenHead,
  freshnessWindowMs,
}: {
  report: ScanReport;
  onRetest?: () => void;
  /** A re-test is already in flight (the live view keeps the report up + shows a banner) — disable
   *  the control so a second click can't stack another run. */
  rescanning?: boolean;
  /** `Repository.headSha`, the head this product LAST SAW for the repo (server-read via getHeadHint,
   *  no GitHub call). Null/absent suppresses the drift clause entirely: an unrecorded hint is not
   *  evidence that the repo moved. */
  lastSeenHead?: string | null;
  /** The pipeline's own belief window (`scanMaxCacheAgeMs()`), read server-side and threaded so one
   *  knob governs both the re-scan gate and this label. Absent means no tiering claim is made. */
  freshnessWindowMs?: number | null;
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

  // Re-derived every tick so the tier (not just the relative time) stays honest without a reload.
  const state = reportFreshnessState({
    scannedAt: report.scannedAt,
    scoredSha: report.repo.headSha,
    lastSeenHead,
    windowMs: freshnessWindowMs,
  });
  // The ONE action, promoted rather than duplicated: a stale or drifted reading makes the existing
  // Re-test the primary affordance and names what it would do. `aging` and `unknown` deliberately
  // do not promote: a near-fresh reading and an undated one are statements, not calls to spend a
  // scan slot.
  const promote = state.tier === "stale" || state.drifted;
  const retestClass = pillClass({ accent: promote });
  const retestLabel = promote ? "Re-test to refresh this reading" : "Re-test";
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

  const row = (
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
        Scanned{" "}
        <span data-testid="freshness-age" className={AGE_TONE[state.tier]}>
          {freshness(report.scannedAt)}
        </span>
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
          {rescanning ? "Re-scanning…" : retestLabel}
        </button>
      ) : (
        <a href={retestHref} className={retestClass}>
          {refreshIcon}
          {retestLabel}
        </a>
      )}
    </div>
  );

  // A `current` reading on the scored commit has nothing to add: render exactly today's single line,
  // in today's DOM shape, so the quiet case stays quiet.
  const hasClause = Boolean(state.reason) || state.drifted;

  return (
    <>
    {hasClause ? (
      <div className="flex flex-col items-start gap-1 sm:items-end">
        {row}
        <FreshnessClause state={state} />
      </div>
    ) : (
      row
    )}

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

/**
 * The stated reason for a non-current tier, and the drift clause. Both are facts ABOUT the claim the
 * page publishes, so they sit under the age rather than behind a tooltip: a reader who never hovers
 * is exactly the reader most likely to mistake an old score for a present-tense one.
 *
 * The drift wording is deliberate. `Repository.headSha` is a remembered hint, so this says "last seen
 * head", never "current head" - the honest claim the two stored columns actually support.
 */
function FreshnessClause({ state }: { state: ReportFreshnessState }) {
  return (
    <div className="flex flex-col items-start gap-0.5 type-mono-sm sm:items-end">
      {state.reason && (
        <p data-testid="freshness-reason" className="max-w-xs text-right text-amber-200/90 sm:max-w-sm">
          {state.reason}
        </p>
      )}
      {state.drifted && state.scoredSha && state.lastSeenHead && (
        <p data-testid="freshness-drift" className="max-w-xs text-right text-slate-400 sm:max-w-sm">
          <span className="text-slate-500">scored </span>
          <span className="text-slate-300">{state.scoredSha}</span>
          <span className="text-slate-500">, last seen head </span>
          <span className="text-slate-300">{state.lastSeenHead}</span>
          <span className="block text-slate-500">{state.driftNote}</span>
        </p>
      )}
    </div>
  );
}
