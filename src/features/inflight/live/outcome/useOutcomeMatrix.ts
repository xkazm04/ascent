"use client";

// The outcome sheet's state, shared by every composition of the section (v1 and the Prism v2): the review
// gate (an owner's approve/dismiss POSTs, then the run's detail is refetched so the ruling renders from the
// store, not from a client guess), the merged run details, the folded matrix and the pending-proposal count.

import { useCallback, useMemo, useState } from "react";
import { pendingLoopProposals } from "@/features/inflight/proposals/proposalsModel";
import { fetchLoopDetail, reviewLoopDeliverable } from "../cockpit/loopClient";
import type { LoopRunDetail } from "../cockpit/loopTypes";
import { buildOutcomeMatrix, mergeRunDetails } from "./outcomeMatrix";

export function useOutcomeMatrix(p: { slug: string; runDetails: LoopRunDetail[]; liveDetail: LoopRunDetail | null; openedDetail: LoopRunDetail | null }) {
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
  const merged = useMemo(
    () => mergeRunDetails(p.runDetails, p.openedDetail, p.liveDetail, ...Object.values(reviewed)),
    [p.runDetails, p.openedDetail, p.liveDetail, reviewed],
  );
  const matrix = useMemo(() => buildOutcomeMatrix(merged), [merged]);
  // The same pending set the Proposals tab lists — the sheet stays a reading, the ledger is where a
  // batch of them is decided (2026-09-15).
  const pending = useMemo(() => pendingLoopProposals(merged).length, [merged]);
  return { matrix, pending, onReview, reviewError };
}
