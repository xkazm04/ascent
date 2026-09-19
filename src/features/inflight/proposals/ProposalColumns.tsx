"use client";

// The Proposals ledger's columns. One column set over both sources; where a loop proposal has no
// value for a column (impact/effort, projected points) it prints a dash rather than inventing one.

import Link from "next/link";
import { reportPermalink, timeAgo } from "@/lib/ui";
import type { DecisionColumn } from "@/components/org/shared/DecisionTable";
import { ClaimLine, ImpactEffort, NeedsHumanChip, Points, StatusPill } from "@/components/org/followups/FollowupChips";
import type { DimensionSpread } from "@/components/org/followups/followupsModel";
import type { ProposalRow } from "./proposalsModel";

function Dash() {
  return <span className="type-caption text-slate-600">—</span>;
}

/** The loop proposal's state, in the status column's pill vocabulary. */
function LoopPill() {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/40 px-2 py-px type-caption text-accent"
      title="Armed by a loop run and not resolved — approve or dismiss it"
    >
      awaiting review
    </span>
  );
}

function DimCell({ r, spread }: { r: ProposalRow; spread?: DimensionSpread }) {
  if (!r.dimId) return <Dash />;
  return (
    <>
      <span className="whitespace-nowrap type-caption text-slate-400" title={r.source === "scan" ? r.dimLabel : r.dimId}>
        {r.dimId}
      </span>
      {r.source === "scan" && spread?.orgWide && (
        <span
          className="ml-1.5 whitespace-nowrap rounded border border-amber-400/40 px-1 font-mono type-micro uppercase tracking-wider text-amber-300"
          title={`Open in ${spread.repos} of ${spread.of} repos — an org-wide gap: fix it once as a practice, copying whoever already nails it`}
        >
          org-wide {spread.repos}/{spread.of}
        </span>
      )}
    </>
  );
}

export function proposalColumns(org: string, spread: Map<string, DimensionSpread>): DecisionColumn<ProposalRow>[] {
  return [
    {
      key: "repo",
      header: "Repo",
      cell: (r) => (
        <Link href={reportPermalink(r.repo, null, org)} className="focus-ring whitespace-nowrap rounded type-caption text-slate-400 hover:text-accent" title={r.repo}>
          {r.repoName}
        </Link>
      ),
    },
    { key: "dim", header: "Dim", cell: (r) => <DimCell r={r} spread={r.dimId ? spread.get(r.dimId) : undefined} /> },
    {
      key: "title",
      header: "Proposal",
      cell: (r, { open, toggleOpen }) => (
        <button type="button" onClick={toggleOpen} aria-expanded={open} className="focus-ring text-left type-body-sm text-slate-100 hover:text-white">
          {r.source === "loop" && (
            <span className="mr-2 whitespace-nowrap rounded border border-divider px-1 font-mono type-micro uppercase tracking-wider text-slate-400">loop</span>
          )}
          {r.title}
          {r.source === "scan" && r.unlocks && <span className="ml-2 type-caption text-slate-500">→ {r.unlocks}</span>}
        </button>
      ),
    },
    { key: "ie", header: "I·E", title: "impact · effort", cell: (r) => (r.source === "scan" ? <ImpactEffort r={r} /> : <Dash />) },
    { key: "pts", header: "+pts", align: "right", cell: (r) => (r.source === "scan" ? <Points n={r.projectedPoints} /> : <Dash />) },
    {
      key: "status",
      header: "Status",
      // WHO HOLDS IT, beside what state it is in (moonshot #3): a claimed row and a row needing a
      // person are both still open, so the chips sit WITH the status rather than replacing it.
      cell: (r) =>
        r.source === "scan" ? (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill status={r.status} at={r.lastActivityAt} />
            <NeedsHumanChip r={r} />
            <ClaimLine r={r} />
          </span>
        ) : (
          <LoopPill />
        ),
    },
    {
      key: "age",
      header: "Age",
      align: "right",
      cell: (r) => <span className="type-caption text-slate-500">{timeAgo(r.source === "scan" ? r.lastActivityAt : r.proposedAt)}</span>,
    },
  ];
}
