// The Proposals batch bar's claim verbs: "Take over N" and "Send back N".
//
// Builds DecisionAction objects only (no hooks, so no "use client"). Each action's `appliesTo` is the
// same pure table the expanded row and POST /api/org/followups/claims read (claimActionsFor), so the
// count on the bar is exactly the rows the route will accept for this viewer. Neither verb applies to
// a loop proposal: a loop proposal is ruled on, not claimed.

import type { DecisionAction } from "@/components/org/shared/DecisionTable";
import { claimActionsFor, postClaimVerb, type ClaimVerb, type ClaimViewer } from "@/components/org/followups/claimActionsModel";
import { isScanProposal, type ProposalRow } from "./proposalsModel";

export interface ClaimBatchInput {
  org: string;
  viewer: ClaimViewer;
  /** Called after a verb settles (the ledger refresh). */
  onDone: () => void;
  now?: Date;
}

const VERBS: { verb: ClaimVerb; label: string; busyLabel: string }[] = [
  { verb: "take-over", label: "Take over", busyLabel: "Taking over…" },
  { verb: "send-back", label: "Send back", busyLabel: "Sending back…" },
];

export function claimBatchActions({ org, viewer, onDone, now }: ClaimBatchInput): DecisionAction<ProposalRow>[] {
  return VERBS.map(({ verb, label, busyLabel }) => {
    const appliesTo = (r: ProposalRow) => isScanProposal(r) && claimActionsFor(r, viewer, now ?? new Date()).includes(verb);
    return {
      key: verb,
      label,
      busyLabel,
      tone: "neutral" as const,
      appliesTo,
      run: async (picked: ProposalRow[]) => {
        const ids = picked.filter(appliesTo).map((r) => r.id);
        if (ids.length > 0) await postClaimVerb(org, verb, ids);
        onDone();
      },
    };
  });
}
