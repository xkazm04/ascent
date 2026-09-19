"use client";

// The Proposals ledger — the Follow-ups worklist's shape (filter, tick a batch, act from a sticky bar,
// expand a row in place), now over BOTH sources of proposed work (proposalsModel.ts) and drawn by the
// shared DecisionTable. The batch actions are source-aware and only offered when the selection holds
// rows they apply to:
//
//   Dismiss N           — either source (a follow-up PATCH, or the loop review's `dismissed`)
//   Resolve N           — scan follow-ups only, by hand
//   Approve N           — loop proposals only (the loop review's `approved`)
//   Generate fix prompt — scan follow-ups only; hands the batch to a local agent

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SectionEmpty } from "@/components/org/shared/ui";
import { DecisionTable, type DecisionAction } from "@/components/org/shared/DecisionTable";
import { FilterMenu } from "@/features/standing/overview/FilterMenu";
import { FollowupsFilterBar } from "@/components/org/followups/FollowupsFilterBar";
import { FollowupsPromptModal } from "@/components/org/followups/FollowupsPromptModal";
import { dimensionSpread, emptyFilters, isSelectable, patchStatuses, type FollowUpFilters, type FollowUpRow } from "@/components/org/followups/followupsModel";
import { reviewLoopDeliverable } from "@/features/inflight/live/cockpit/loopClient";
import { ProposalDetail } from "./ProposalDetail";
import { proposalColumns } from "./ProposalColumns";
import {
  SOURCE_LABEL,
  applyProposalFilters,
  isLoopProposal,
  isScanProposal,
  type LoopProposal,
  type ProposalRow,
} from "./proposalsModel";

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
}: {
  org: string;
  rows: ProposalRow[];
  initialDim?: string;
  /** Owner-only: the loop review gate. A viewer who cannot rule cannot tick a loop proposal. */
  canReview: boolean;
}) {
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
  ];

  const toggleSource = (v: string) =>
    setSources((s) => {
      const next = new Set(s);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  return (
    // data-tour: the getting-started `gap-engaged` step spotlights this ledger — engaging with a gap
    // IS resolving, dismissing or handing off a row here.
    <div data-tour="backlog-recs" className="space-y-4">
      <FollowupsFilterBar rows={rows} filters={filters} onChange={setFilters} shown={shown.length} orgWideDims={orgWideDims}>
        <FilterMenu label="Source" options={SOURCE_OPTIONS} selected={sources} onToggle={toggleSource} onClear={() => setSources(new Set())} />
      </FollowupsFilterBar>

      <DecisionTable
        caption="Proposals ledger"
        rows={shown}
        allRows={rows}
        rowId={(r) => r.id}
        rowLabel={(r) => r.title}
        columns={columns}
        selected={selected}
        onSelectedChange={setSelected}
        isSelectable={(r) => (r.source === "scan" ? isSelectable(r) : canReview)}
        isMuted={(r) => r.source === "scan" && !isSelectable(r)}
        renderDetail={(r) => <ProposalDetail org={org} row={r} canReview={canReview} />}
        summary={(picked) => <Summary picked={picked} />}
        actions={actions}
        minWidth={880}
        empty={<SectionEmpty>Nothing matches. Widen the filters, or switch to the resolved archive.</SectionEmpty>}
      />

      <FollowupsPromptModal org={org} items={promptFor} onClose={() => setPromptFor(null)} onHandedOff={() => setSelected(new Set())} />
    </div>
  );
}
