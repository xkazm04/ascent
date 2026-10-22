"use client";

// The Proposals ledger, composition. Same props and the same useProposalsView as ProposalsWorklist; the
// ledger is the kit-built DecisionLedger (ruled rows, a Frame bar) and the filters are ProposalFilters.
import { useMemo } from "react";
import { FollowupsPromptModal } from "@/components/shared/followups/FollowupsPromptModal";
import { isSelectable } from "@/components/shared/followups/followupsModel";
import type { ClaimViewer } from "@/components/shared/followups/claimActionsModel";
import { DecisionLedger } from "@/components/kit";
import { ProposalDetail } from "./ProposalDetail";
import { proposalColumnsView } from "./ProposalColumnsView";
import { ProposalFilters } from "./ProposalFilters";
import { isScanProposal, type ProposalRow } from "./proposalsModel";
import { useProposalsView } from "./useProposalsView";

function Summary({ picked }: { picked: ProposalRow[] }) {
  const scan = picked.filter(isScanProposal);
  const loop = picked.length - scan.length;
  const repos = new Set(picked.map((r) => r.repo)).size;
  const points = scan.reduce((s, r) => s + (r.projectedPoints ?? 0), 0);
  return (
    <span className="tabular-nums">
      {picked.length} selected · {repos} repo{repos === 1 ? "" : "s"}
      {loop > 0 ? ` · ${loop} from the loop` : ""} · +{points} points if all close
    </span>
  );
}

export function ProposalsWorklist({
  org,
  rows,
  initialDim,
  canReview,
  viewer,
}: {
  org: string;
  rows: ProposalRow[];
  initialDim?: string;
  canReview: boolean;
  viewer: ClaimViewer;
}) {
  const v = useProposalsView({ org, rows, initialDim, viewer });
  const columns = useMemo(() => proposalColumnsView(org, v.spread), [org, v.spread]);
  return (
    <div data-tour="backlog-recs" className="space-y-5">
      <ProposalFilters
        rows={rows}
        filters={v.filters}
        onChange={v.setFilters}
        shown={v.shown.length}
        orgWideDims={v.orgWideDims}
        sources={v.sources}
        onToggleSource={v.toggleSource}
        onClearSources={v.clearSources}
      />
      <DecisionLedger
        caption="Proposals ledger"
        rows={v.shown}
        allRows={rows}
        rowId={(r) => r.id}
        rowLabel={(r) => r.title}
        columns={columns}
        selected={v.selected}
        onSelectedChange={v.setSelected}
        isSelectable={(r) => (r.source === "scan" ? isSelectable(r) : canReview)}
        isMuted={(r) => r.source === "scan" && !isSelectable(r)}
        renderDetail={(r) => <ProposalDetail org={org} row={r} canReview={canReview} viewer={viewer} />}
        summary={(picked) => <Summary picked={picked} />}
        actions={v.actions}
        minWidth={880}
        empty={<p className="type-body-sm text-slate-400">Nothing matches. Widen the filters, or switch to the resolved archive.</p>}
      />
      <FollowupsPromptModal org={org} viewer={viewer} items={v.promptFor} onClose={() => v.setPromptFor(null)} onHandedOff={() => v.setSelected(new Set())} />
    </div>
  );
}
