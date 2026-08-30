"use client";

// THE OUTCOME SECTION — full width under the observatory grid. It absorbs the old history strip's job
// (every run header opens that run on the field) and the rail's outcome mode (the deliverables are
// the rows). The Storyboard is the surviving direction: a frame per run, a section per repo inside
// the open frame, ONE ROW PER GAP — and the review gate lives here: an owner's ✓/✕ on a row POSTs
// through `reviewLoopDeliverable`, then the run's detail is refetched so the ruling renders from the
// store, not from a client guess.

import { useCallback, useMemo, useState } from "react";
import { Kicker } from "@/components/ui";
import { DriveVerdict } from "../cockpit/CockpitDrivePanel";
import type { DriveStatus } from "../cockpit/driveTypes";
import { fetchLoopDetail, reviewLoopDeliverable } from "../cockpit/loopClient";
import type { LoopRunDetail } from "../cockpit/loopTypes";
import { OutcomeStoryboard } from "./OutcomeStoryboard";
import { buildOutcomeMatrix, mergeRunDetails } from "./outcomeMatrix";
import { takeaway } from "./outcomeText";

export type OutcomeVariant = "storyboard";

export interface OutcomeSectionProps {
  variant: OutcomeVariant;
  slug: string;
  /** The SSR snapshot of the listed runs' details. */
  runDetails: LoopRunDetail[];
  /** The live or just-settled detail from the poll, and the run the operator opened — both outrank the snapshot. */
  liveDetail: LoopRunDetail | null;
  openedDetail: LoopRunDetail | null;
  selectedId: string | null;
  driveOutcome: DriveStatus | null;
  /** The owner's quick-approval gate — false for a viewer who cannot rule. */
  canReview: boolean;
  onOpen: (id: string) => void;
  onDismissDrive: () => void;
}

export function OutcomeSection(p: OutcomeSectionProps) {
  // Details refetched after a review — freshest by construction, so they outrank every other source.
  const [reviewed, setReviewed] = useState<Record<string, LoopRunDetail>>({});
  const [reviewError, setReviewError] = useState<string | null>(null);
  const { slug } = p;
  const onReview = useCallback(
    async (runId: string, laneId: string, cover: string, verdict: "approved" | "dismissed") => {
      try {
        setReviewError(null);
        await reviewLoopDeliverable(slug, laneId, cover, verdict);
        const detail = await fetchLoopDetail(slug, runId);
        setReviewed((prev) => ({ ...prev, [runId]: detail }));
      } catch (err) {
        setReviewError(err instanceof Error ? err.message : "Could not record the review.");
      }
    },
    [slug],
  );
  const matrix = useMemo(
    () => buildOutcomeMatrix(mergeRunDetails(p.runDetails, p.openedDetail, p.liveDetail, ...Object.values(reviewed))),
    [p.runDetails, p.openedDetail, p.liveDetail, reviewed],
  );
  return (
    <section aria-label="Loop outcome" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-divider pb-2">
        <div className="min-w-0">
          <Kicker tone="accent">Outcome</Kicker>
          <h3 className="type-title mt-0.5 font-semibold tracking-tight text-slate-100">{takeaway(matrix)}</h3>
        </div>
        {matrix.columns.length > 0 && (
          <span className="type-caption tabular-nums text-slate-500">
            {matrix.totals.repos} {matrix.totals.repos === 1 ? "repo" : "repos"} · {matrix.totals.gaps} gaps closed · click a run to widen it
          </span>
        )}
      </div>
      {reviewError && <p className="type-caption text-danger">{reviewError}</p>}
      {p.driveOutcome && <DriveVerdict drive={p.driveOutcome} onBack={p.onDismissDrive} />}
      {matrix.columns.length === 0 ? (
        <p className="type-body-sm rounded-2xl border border-dashed border-divider px-4 py-6 text-center text-slate-400">
          No runs yet — select repos in the sky and start a run. Each run will land here as a column.
        </p>
      ) : (
        <OutcomeStoryboard matrix={matrix} selectedId={p.selectedId} onOpen={p.onOpen} canReview={p.canReview} onReview={onReview} />
      )}
    </section>
  );
}
