"use client";

// THE OUTCOME SECTION — full width under the observatory grid, and THE outcome surface: the rail no
// longer has an outcome mode and there is no second variant to switch to. It absorbs the old history
// strip's job (every run column opens that run and drifts the field) and the old rail ledger's
// (the gaps are the rows).
//
// The review gate lives here: an owner's ✓/✕ on a cell POSTs through `reviewLoopDeliverable`, then
// the run's detail is refetched so the ruling renders from the store, not from a client guess.

import { useCallback, useMemo, useState } from "react";
import { Kicker } from "@/components/ui";
import { DriveVerdict } from "../cockpit/CockpitDrivePanel";
import { CockpitVerdicts } from "../cockpit/CockpitVerdicts";
import type { DriveStatus } from "../cockpit/driveTypes";
import { fetchLoopDetail, reviewLoopDeliverable } from "../cockpit/loopClient";
import type { LoopRunDetail } from "../cockpit/loopTypes";
import { OutcomeSheet } from "./OutcomeSheet";
import { buildOutcomeMatrix, mergeRunDetails } from "./outcomeMatrix";
import { takeaway } from "./outcomeText";

export interface OutcomeSectionProps {
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
  // The agent's per-item account for the run on screen — shown only when the run recorded one, so an
  // empty panel never sits under a full sheet.
  const itemOutcomes = (p.openedDetail ?? p.liveDetail)?.itemOutcomes ?? [];
  return (
    <section aria-label="Loop outcome" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-divider pb-2">
        <div className="min-w-0">
          <Kicker tone="accent">Outcome</Kicker>
          <h3 className="type-title mt-0.5 font-semibold tracking-tight text-slate-100">{takeaway(matrix)}</h3>
        </div>
        {matrix.columns.length > 0 && (
          <span className="type-caption tabular-nums text-slate-500">
            {matrix.totals.repos} {matrix.totals.repos === 1 ? "repo" : "repos"} · {matrix.totals.gaps} gaps closed · drag a column edge to widen it
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
        <OutcomeSheet
          matrix={matrix}
          slug={slug}
          selectedId={p.selectedId}
          onOpen={p.onOpen}
          canReview={p.canReview}
          onReview={onReview}
        />
      )}
      {itemOutcomes.length > 0 && <CockpitVerdicts outcomes={itemOutcomes} />}
    </section>
  );
}
