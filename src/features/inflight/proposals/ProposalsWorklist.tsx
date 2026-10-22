"use client";

// The Proposals ledger (Altimeter composition) — the Follow-ups worklist's shape (filter, tick a batch, act
// from a sticky bar, expand a row in place) over BOTH sources of proposed work (proposalsModel.ts), drawn by
// the shared DecisionTable. State and the source-aware batch actions live in useProposalsView, which the
// Prism composition (ProposalsWorklist.v2.tsx) calls too.

import { SectionEmpty } from "@/components/org/shared/ui";
import { DecisionTable } from "@/components/org/shared/DecisionTable";
import { FilterMenu } from "@/components/kit";
import { FollowupsFilterBar } from "@/components/org/followups/FollowupsFilterBar";
import { FollowupsPromptModal } from "@/components/org/followups/FollowupsPromptModal";
import { isSelectable } from "@/components/org/followups/followupsModel";
import type { ClaimViewer } from "@/components/org/followups/claimActionsModel";
import { ProposalDetail } from "./ProposalDetail";
import { SOURCE_LABEL, isScanProposal, type ProposalRow } from "./proposalsModel";
import { useProposalsView } from "./useProposalsView";

const SOURCE_OPTIONS = (["loop", "scan"] as const).map((v) => ({ value: v, label: SOURCE_LABEL[v] }));

function Summary({ picked }: { picked: ProposalRow[] }) {
  const scan = picked.filter(isScanProposal);
  const loop = picked.length - scan.length;
  const repos = new Set(picked.map((r) => r.repo)).size;
  const points = scan.reduce((s, r) => s + (r.projectedPoints ?? 0), 0);
  return (
    <>
      <span className="font-bold tabular-nums">{picked.length}</span> selected · <span className="tabular-nums">{repos}</span> repo
      {repos === 1 ? "" : "s"}
      {loop > 0 && (
        <>
          {" "}· <span className="tabular-nums">{loop}</span> from the loop
        </>
      )}{" "}
      · <span className="tabular-nums text-white">+{points}</span> pts if all close
    </>
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
  /** Owner-only: the loop review gate. A viewer who cannot rule cannot tick a loop proposal. */
  canReview: boolean;
  /** Who is looking, for the claim verbs: login and admin role, resolved server-side. */
  viewer: ClaimViewer;
}) {
  const v = useProposalsView({ org, rows, initialDim, viewer });

  return (
    // data-tour: the getting-started `gap-engaged` step spotlights this ledger — engaging with a gap
    // IS resolving, dismissing or handing off a row here.
    <div data-tour="backlog-recs" className="space-y-4">
      <FollowupsFilterBar rows={rows} filters={v.filters} onChange={v.setFilters} shown={v.shown.length} orgWideDims={v.orgWideDims}>
        <FilterMenu label="Source" options={SOURCE_OPTIONS} selected={v.sources} onToggle={v.toggleSource} onClear={v.clearSources} />
      </FollowupsFilterBar>

      <DecisionTable
        caption="Proposals ledger"
        rows={v.shown}
        allRows={rows}
        rowId={(r) => r.id}
        rowLabel={(r) => r.title}
        columns={v.columns}
        selected={v.selected}
        onSelectedChange={v.setSelected}
        isSelectable={(r) => (r.source === "scan" ? isSelectable(r) : canReview)}
        isMuted={(r) => r.source === "scan" && !isSelectable(r)}
        renderDetail={(r) => <ProposalDetail org={org} row={r} canReview={canReview} viewer={viewer} />}
        summary={(picked) => <Summary picked={picked} />}
        actions={v.actions}
        minWidth={880}
        empty={<SectionEmpty>Nothing matches. Widen the filters, or switch to the resolved archive.</SectionEmpty>}
      />

      <FollowupsPromptModal org={org} viewer={viewer} items={v.promptFor} onClose={() => v.setPromptFor(null)} onHandedOff={() => v.setSelected(new Set())} />
    </div>
  );
}
