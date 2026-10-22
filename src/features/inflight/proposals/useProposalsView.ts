"use client";

// The Proposals ledger's state and actions: ONE hook the ledger calls, so
// the ledger's views cannot drift on filters, selection or what a batch action does.
// Batch actions are source-aware and only offered when the selection holds rows they apply to:
//
//   Dismiss N           — either source (a follow-up PATCH, or the loop review's `dismissed`)
//   Resolve N           — scan follow-ups only, by hand
//   Approve N           — loop proposals only (the loop review's `approved`)
//   Generate fix prompt — scan follow-ups only; hands the batch to a local agent
//   Take over N / Send back N - held scan follow-ups, per the claim table (claimBatchActions.ts)

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DecisionAction } from "@/components/shared/recs/DecisionTable";
import { dimensionSpread, emptyFilters, patchStatuses, type FollowUpFilters, type FollowUpRow } from "@/components/shared/followups/followupsModel";
import type { ClaimViewer } from "@/components/shared/followups/claimActionsModel";
import { reviewLoopDeliverable } from "@/features/inflight/live/cockpit/loopClient";
import { claimBatchActions } from "./claimBatchActions";
import { proposalColumns } from "./ProposalColumns";
import { applyProposalFilters, isLoopProposal, isScanProposal, type LoopProposal, type ProposalRow } from "./proposalsModel";

export function useProposalsView({ org, rows, initialDim, viewer }: { org: string; rows: ProposalRow[]; initialDim?: string; viewer: ClaimViewer }) {
  const router = useRouter();
  const [filters, setFilters] = useState<FollowUpFilters>(() => ({ ...emptyFilters(), dims: new Set(initialDim ? [initialDim] : []) }));
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [promptFor, setPromptFor] = useState<FollowUpRow[] | null>(null);

  const scanRows = useMemo(() => rows.filter(isScanProposal), [rows]);
  const spread = useMemo(() => dimensionSpread(scanRows), [scanRows]);
  const columns = useMemo(() => proposalColumns(org, spread), [org, spread]);
  const shown = applyProposalFilters(rows, filters, sources, spread);
  const orgWideDims = [...spread.values()].filter((s) => s.orgWide).length;

  const review = async (picked: LoopProposal[], verdict: "approved" | "dismissed") => {
    for (const r of picked) await reviewLoopDeliverable(org, r.laneId, r.cover, verdict);
  };
  const actions: DecisionAction<ProposalRow>[] = [
    {
      key: "dismiss",
      label: "Dismiss",
      busyLabel: "Dismissing…",
      tone: "neutral",
      run: async (picked) => {
        await patchStatuses(picked.filter(isScanProposal).map((r) => r.id), "dismissed");
        await review(picked.filter(isLoopProposal), "dismissed");
        router.refresh();
      },
    },
    {
      key: "resolve",
      label: "Resolve",
      busyLabel: "Resolving…",
      tone: "positive",
      appliesTo: isScanProposal,
      run: async (picked) => {
        await patchStatuses(picked.filter(isScanProposal).map((r) => r.id), "done");
        router.refresh();
      },
    },
    {
      key: "approve",
      label: "Approve",
      busyLabel: "Approving…",
      tone: "positive",
      appliesTo: isLoopProposal,
      run: async (picked) => {
        await review(picked.filter(isLoopProposal), "approved");
        router.refresh();
      },
    },
    {
      key: "prompt",
      label: "Generate fix prompt →",
      busyLabel: "Generating…",
      tone: "primary",
      countless: true,
      appliesTo: isScanProposal,
      run: (picked) => {
        setPromptFor(picked.filter(isScanProposal));
        return false; // the modal settles the batch; the selection stays until it does
      },
    },
    ...claimBatchActions({ org, viewer, onDone: () => router.refresh() }),
  ];

  const toggleSource = (v: string) =>
    setSources((s) => {
      const next = new Set(s);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  return { spread, filters, setFilters, sources, toggleSource, clearSources: () => setSources(new Set()), selected, setSelected, promptFor, setPromptFor, columns, shown, orgWideDims, actions };
}
