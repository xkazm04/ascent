"use client";

// Per-row chrome for RecommendationTracker, extracted so the tracker stays an orchestrator under the
// 300-LOC ceiling: the busy indicator, the save-failure notice, and the dismissal-reason capture.
//
// The reason prompt is the UI half of "a dismissal becomes evidence the next scan hears". Dismissing a
// gap is the one moment a team volunteers the context the assessment lacks ("we're on Bazel, that gap
// doesn't apply") — the reason is sent as the PATCH's `note`, and the API turns it into a standing
// decision the next scan's prompt reads. Skipping is a first-class choice: a dismissal with no reason
// is still a dismissal, it just doesn't speak for the team in the next scan.

import { useState } from "react";
import { REC_NOTE_MAX_LENGTH, type DimensionId, type RecStatus } from "@/lib/types";
import { reconcileDoneRec, type ReconciliationState } from "@/lib/report/compare";

/** Small busy indicator for the row currently saving (frozen, not spinning, under reduced motion). */
export function RowSpinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-accent motion-reduce:animate-none"
    />
  );
}

/** A per-row save failure: the change the user attempted, and whether it's recoverable. */
export interface RowError {
  /** The status change that failed — re-applied by the Retry button. */
  status: RecStatus;
  /** "config" = persistence not available (503, retry won't help); "stale" = this page's scan has
   *  been superseded by a newer one (retry would 409 forever — reload instead); "transient" = retryable. */
  kind: "config" | "stale" | "transient";
  message: string;
  /** The reason typed alongside a failed dismissal, so Retry resubmits it rather than dropping it. */
  reason?: string;
}

/** Non-retryable kinds (config, stale) render informational amber; only transient is red + Retry. */
export function RowErrorNotice({
  err,
  saving,
  onRetry,
  onDismiss,
}: {
  err: RowError;
  saving: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const transient = err.kind === "transient";
  return (
    <div
      role="alert"
      className={`mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        transient ? "border-red-500/30 bg-red-500/5 text-red-200/90" : "border-amber-500/30 bg-amber-500/5 text-amber-200/90"
      }`}
    >
      <span aria-hidden>{transient ? "⚠" : "ⓘ"}</span>
      <span className="flex-1">{err.message}</span>
      {transient ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={saving}
          className="rounded-md border border-red-500/40 px-2 py-0.5 font-medium text-red-200 transition hover:bg-red-500/10 disabled:opacity-50"
        >
          Retry
        </button>
      ) : (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-amber-500/40 px-2 py-0.5 font-medium text-amber-200 transition hover:bg-amber-500/10"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

/** Muted for the two states that assert nothing about the work; emerald/amber only when the score
 *  genuinely moved. `not-measured` must never borrow the "didn't improve" colour. */
const RECONCILE_TONE: Record<ReconciliationState, string> = {
  "not-measured": "border-slate-700 bg-slate-900/40 text-slate-400",
  flat: "border-slate-700 bg-slate-900/40 text-slate-300",
  improved: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200/90",
  declined: "border-amber-500/30 bg-amber-500/5 text-amber-200/90",
};

/**
 * "You marked it done — did the score move?" Shown on a `done` row, where the user made the call,
 * rather than only in the compare view they may never open. Companion voice: an observation the team
 * is free to disagree with. Nothing here reverts or questions their `done`.
 *
 * `prevScore`/`currentScore` come from the two scans; either being absent yields the `not-measured`
 * line, which says so plainly instead of implying the work didn't land.
 */
export function DoneReconciliation({
  dimension,
  prevScore,
  currentScore,
}: {
  dimension: DimensionId;
  prevScore: number | null | undefined;
  currentScore: number | null | undefined;
}) {
  const r = reconcileDoneRec(dimension, prevScore, currentScore);
  return (
    <p className={`mt-2 rounded-lg border px-3 py-1.5 text-sm ${RECONCILE_TONE[r.state]}`}>
      <span className="font-medium">You marked this done.</span> {r.note}
    </p>
  );
}

/**
 * Inline capture of WHY a gap is being dismissed. Rendered in the row itself (not a modal) so the
 * choice stays next to the thing being judged. Companion voice: the ask is invitational and skipping
 * is offered as an equal button, never buried — but the copy is honest that skipping means the next
 * scan won't know.
 */
export function DismissReasonPrompt({
  onConfirm,
  onCancel,
}: {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const tooLong = trimmed.length > REC_NOTE_MAX_LENGTH;
  return (
    <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <label htmlFor="dismiss-reason" className="block text-sm font-medium text-slate-200">
        Why is this gap not for you?
      </label>
      <p className="mt-0.5 text-sm text-slate-400">
        Whatever you write here is read by the next scan, so it stops re-raising this gap. Skip it and
        the next scan will surface it again — it has no way of knowing.
      </p>
      <textarea
        id="dismiss-reason"
        value={reason}
        autoFocus
        rows={2}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. we build with Bazel, so this doesn't apply here"
        className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-accent focus:outline-none"
      />
      {tooLong && (
        <p role="alert" className="mt-1 text-sm text-amber-300/90">
          That&rsquo;s {trimmed.length} characters — trim it to {REC_NOTE_MAX_LENGTH} or fewer.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!trimmed || tooLong}
          onClick={() => onConfirm(trimmed)}
          className="rounded-md border border-accent/40 px-2 py-0.5 text-sm font-medium text-accent transition hover:bg-accent/10 disabled:opacity-40"
        >
          Dismiss with this reason
        </button>
        <button
          type="button"
          onClick={() => onConfirm("")}
          className="rounded-md border border-slate-700 px-2 py-0.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
        >
          Dismiss without a reason
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-0.5 text-sm font-medium text-slate-500 transition hover:text-slate-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
