"use client";

// The Proposals ledger's columns, Prism composition: same column set and keys as ProposalColumns, drawn as
// words and glyphs (status never travels by hue), a dimension named by its mark, and no mono caps.
// Where a loop proposal has no value for a column it prints a dash rather than inventing one.
import Link from "next/link";
import { Chip, DimensionMark, type LedgerColumn } from "@/components/kit";
import { STATUS_LABEL, type FollowUpStatus } from "@/components/org/followups/followupsModel";
import { ClaimLine } from "@/components/org/followups/FollowupChips";
import { reportPermalink, timeAgo } from "@/lib/ui";
import type { DimensionSpread } from "@/components/org/followups/followupsModel";
import type { ProposalRow } from "./proposalsModel";

const GLYPH: Record<FollowUpStatus, string> = { open: "○", in_progress: "◐", done: "✓", dismissed: "–" };

function Dash() {
  return <span className="type-caption text-slate-500">—</span>;
}

function StatusWord({ status, at }: { status: FollowUpStatus; at?: string }) {
  return (
    <span className="whitespace-nowrap type-caption text-slate-200" title={at ? `last activity ${timeAgo(at)}` : undefined}>
      <span aria-hidden>{GLYPH[status]} </span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function proposalColumnsV2(org: string, spread: Map<string, DimensionSpread>): LedgerColumn<ProposalRow>[] {
  return [
    {
      key: "repo",
      header: "Repo",
      cell: (r) => (
        <Link href={reportPermalink(r.repo, null, org)} className="focus-ring whitespace-nowrap text-slate-200 hover:text-white" title={r.repo}>
          {r.repoName}
        </Link>
      ),
    },
    {
      key: "dim",
      header: "Dimension",
      cell: (r) => {
        const s = r.dimId ? spread.get(r.dimId) : undefined;
        if (!r.dimId) return <Dash />;
        return (
          <span className="inline-flex flex-wrap items-center gap-2">
            <DimensionMark id={r.dimId} label={r.source === "scan" ? r.dimLabel : r.dimId} />
            {r.source === "scan" && s?.orgWide && (
              <Chip tone="warn" title={`Open in ${s.repos} of ${s.of} repos: an org-wide gap. Fix it once as a practice, copying whoever already nails it`}>
                org-wide {s.repos}/{s.of}
              </Chip>
            )}
          </span>
        );
      },
    },
    {
      key: "title",
      header: "Proposal",
      cell: (r, { open, toggleOpen }) => (
        <button type="button" onClick={toggleOpen} aria-expanded={open} className="focus-ring text-left text-white hover:text-accent">
          {r.source === "loop" && (
            <span className="mr-2">
              <Chip>from the loop</Chip>
            </span>
          )}
          {r.title}
          {r.source === "scan" && r.unlocks && <span className="ml-2 type-caption text-slate-400">→ {r.unlocks}</span>}
        </button>
      ),
    },
    {
      key: "ie",
      header: "Impact / effort",
      cell: (r) =>
        r.source === "scan" ? (
          <span className="whitespace-nowrap type-caption text-slate-200" title={`impact ${r.impact}, effort ${r.effort}`}>
            {r.impact} / {r.effort}
          </span>
        ) : (
          <Dash />
        ),
    },
    {
      key: "pts",
      header: "Points",
      align: "right",
      cell: (r) =>
        r.source === "scan" && r.projectedPoints != null ? (
          <span className="tabular-nums text-white" title="Overall-score points the repo gains if this gap fully closes">
            +{r.projectedPoints}
          </span>
        ) : (
          <Dash />
        ),
    },
    {
      key: "status",
      header: "Status",
      // WHO HOLDS IT beside what state it is in: a claimed row and a row needing a person are both still open.
      cell: (r) =>
        r.source === "scan" ? (
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusWord status={r.status} at={r.lastActivityAt} />
            {r.needsHuman && (
              <Chip tone="warn" title="An agent worked this and stopped deliberately: it needs a person. The row is still open.">
                needs human
              </Chip>
            )}
            <ClaimLine r={r} />
          </span>
        ) : (
          <span className="whitespace-nowrap type-caption text-slate-200" title="Armed by a loop run and not resolved: approve or dismiss it">
            <span aria-hidden>◐ </span>awaiting review
          </span>
        ),
    },
    {
      key: "age",
      header: "Age",
      align: "right",
      cell: (r) => <span className="type-caption text-slate-400">{timeAgo(r.source === "scan" ? r.lastActivityAt : r.proposedAt)}</span>,
    },
  ];
}
