"use client";

// One tracked recommendation, as the persisted tracker renders it. Pure relocation out of
// RecommendationTracker.tsx (which sat at 289/300 and had to shed before it could carry the first-step
// line): every element, class and comment below is the row that file already rendered. All state stays
// in the tracker — this file receives values and callbacks, so overlapping saves, optimistic updates
// and rollback are unchanged.

import type { PersistedRecommendation, RecStatus, ScanReport } from "@/lib/types";
import { ExemplarPointer, ExploreList, PayoffChip, RoadmapFirstStep, RoadmapMeta } from "@/components/report/roadmapPieces";
import { isQuickWin, QuickWinBadge, type RoadmapLifts } from "@/components/report/roadmapPriority";
import { ExpectedLiftBasis } from "@/components/report/ExpectedLiftBasis";
import { STATUS_ACCENT } from "@/components/org/shared/backlogShared";
import { StatusSelect } from "@/components/org/shared/recStatusUi";
import {
  DismissReasonPrompt,
  DoneReconciliation,
  RowErrorNotice,
  RowSpinner,
  type RowError,
} from "@/components/report/recommendationRowUi";
import { Kicker } from "@/components/ui";

/**
 * The measured basis, from whichever transport this rendering has.
 *
 * There is ONE source — `getOrgExpectedLifts`, the org-scoped ledger aggregate — reaching the tracker
 * two ways, because the two report paths are served differently:
 *
 * - The permalink (`/report/{owner}/{repo}`) server-renders and threads the DISTRIBUTION MAP down. The
 *   map is the primary transport because ordering needs the numbers: `sortRoadmap(…, "measured")` and
 *   the sort toggle cannot work off a rendered sentence.
 * - The live-scan path (`/report?repo=`) has no server render; `ReportView` fetches the rows from
 *   `GET /api/recommendations`, which computes the very same clause per item and ships it as
 *   `expectedLift: string | null`. Without this branch that field — selected, computed and typed —
 *   would still have no in-app reader, and those rows would silently lose a basis the server sent.
 *
 * Never both: with a map in hand the wire string is ignored, so a row can never show two answers.
 * `expectedLift` is a wire string (a clause or `null`), never a number — a client handed `0` would
 * render "we measured this and it does nothing" (G4).
 */
function MeasuredBasis({ item, lifts }: { item: PersistedRecommendation; lifts: RoadmapLifts }) {
  if (lifts) return <ExpectedLiftBasis item={item} lifts={lifts} />;
  const clause = item.expectedLift;
  if (!clause) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 type-body-sm text-slate-400">
      <Kicker as="span" tone="muted">
        measured
      </Kicker>
      <span title="What this organization observed the last times this gap was closed, under the named instrument">
        {clause}
      </span>
    </div>
  );
}

export function RecommendationRow({
  item,
  index,
  report,
  lifts,
  prevScore,
  currentScore,
  saving,
  err,
  announcement,
  dismissing,
  onPickStatus,
  onBusySwallowed,
  onConfirmDismiss,
  onCancelDismiss,
  onRetry,
  onDismissError,
}: {
  item: PersistedRecommendation;
  /** Position in the CURRENT ordering — the row's displayed priority number. */
  index: number;
  report: ScanReport;
  lifts: RoadmapLifts;
  /** This dimension's score on the previous scan / this one, for the done-row reconciliation. */
  prevScore: number | undefined;
  currentScore: number | undefined;
  saving: boolean;
  err: RowError | undefined;
  announcement: string;
  /** This row's "dismissed" pick is waiting on a reason. */
  dismissing: boolean;
  onPickStatus: (status: RecStatus) => void;
  onBusySwallowed: () => void;
  onConfirmDismiss: (reason: string) => void;
  onCancelDismiss: () => void;
  onRetry: () => void;
  onDismissError: () => void;
}) {
  const muted = item.status === "done" || item.status === "dismissed";
  // Non-retryable kinds (config, stale) render informational amber; only transient is red+Retry.
  const edge = err ? (err.kind === "transient" ? "#ef4444" : "#eab308") : STATUS_ACCENT[item.status];
  return (
    <div
      aria-busy={saving}
      className="rounded-xl border bg-surface/40 p-5"
      style={{ borderLeftWidth: 3, borderLeftColor: edge }}
    >
      {/* Per-row polite live region — each save's success/failure is announced independently,
          so overlapping saves on other rows can't clobber this one's message. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Priority number + quick-win badge mirror RoadmapSteps, so the persisted tracker keeps
            the public roadmap's "do these first" signaling (roadmap-recommendation-tracking #2).
            min-w-0 lets the title shrink; break-words then wraps a long unbroken rec title
            instead of overflowing the row (a rec title is descriptive text — wrap, don't clip). */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 type-mono-sm text-slate-300">
            {index + 1}
          </span>
          <h3 className={`min-w-0 break-words font-semibold ${muted ? "text-slate-400 line-through decoration-slate-600" : "text-white"}`}>
            {item.title}
          </h3>
          {isQuickWin(item) && !muted && <QuickWinBadge />}
        </div>
        <div className="flex items-center gap-2 type-body-sm">
          <RoadmapMeta item={item} />
          <PayoffChip report={report} dim={item.dimension} />
          {saving && <RowSpinner />}
          <StatusSelect
            value={item.status}
            busy={saving}
            onChange={onPickStatus}
            // A pick made WHILE this row is saving is dropped and the select snaps back with no
            // visual cue (the spinner is aria-hidden) — announce the swallow through this row's
            // live region so the user knows to re-pick once the save settles (#4 07-16).
            onBusyChange={onBusySwallowed}
            aria-label="Recommendation status"
          />
        </div>
      </div>
      {/* The single concrete first move, rendered exactly as the public RoadmapSteps renders it (one
          shared component) and in the same position — after the title, above the rationale. The
          tracker selected, typed and received it and then dropped it on the floor, so every
          persistence-enabled org saw a strictly poorer row than the anonymous fallback. Absent ⇒
          nothing renders; nothing is ever invented to fill the line. */}
      <RoadmapFirstStep firstStep={item.firstStep} />
      {item.rationale && <p className="mt-2 type-body leading-relaxed text-slate-400">{item.rationale}</p>}
      {item.status === "done" && (
        <DoneReconciliation dimension={item.dimension} prevScore={prevScore} currentScore={currentScore} />
      )}
      {!muted && <MeasuredBasis item={item} lifts={lifts} />}
      {!muted && <ExploreList items={item.explore} />}
      {!muted && <ExemplarPointer dim={item.dimension} />}
      {dismissing && <DismissReasonPrompt onConfirm={onConfirmDismiss} onCancel={onCancelDismiss} />}
      {err && <RowErrorNotice err={err} saving={saving} onRetry={onRetry} onDismiss={onDismissError} />}
    </div>
  );
}
