"use client";

// A Proposals row, expanded in place. A scan follow-up keeps the body the Follow-ups ledger gave it
// (rationale, explore questions, the per-row resolve/dismiss, its timeline); a loop proposal shows its
// evidence, the one-row approve/dismiss gate, and the way back to the run that armed it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { orgTabHref } from "@/lib/org/orgTabs";
import { RowActions } from "@/components/org/followups/FollowupChips";
import { FollowupHistory } from "@/components/org/followups/FollowupHistory";
import { reviewLoopDeliverable } from "@/features/inflight/live/cockpit/loopClient";
import type { LoopProposal, ProposalRow } from "./proposalsModel";

function LoopProposalDetail({ org, row, canReview }: { org: string; row: LoopProposal; canReview: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approved" | "dismissed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rule = async (verdict: "approved" | "dismissed") => {
    setBusy(verdict);
    setError(null);
    try {
      await reviewLoopDeliverable(org, row.laneId, row.cover, verdict);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the review.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {row.evidence && <p className="max-w-3xl type-body-sm text-slate-300">{row.evidence}</p>}
      <p className="mt-1 max-w-3xl type-caption text-slate-500">
        A loop run armed this and did not resolve it. Approving records your ruling on the run&apos;s outcome; nothing is merged or
        reopened by it.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-4 type-caption">
        {canReview && (
          <>
            <button type="button" onClick={() => void rule("approved")} disabled={busy !== null} className="focus-ring rounded text-slate-500 hover:text-emerald-400">
              {busy === "approved" ? "…" : "approve"}
            </button>
            <button type="button" onClick={() => void rule("dismissed")} disabled={busy !== null} className="focus-ring rounded text-slate-500 hover:text-slate-300">
              {busy === "dismissed" ? "…" : "dismiss"}
            </button>
          </>
        )}
        <Link href={orgTabHref(org, "live")} className="focus-ring rounded text-accent hover:text-white">
          open the run on Live →
        </Link>
        <span className="text-slate-600">run {row.runId.slice(0, 8)}</span>
        {error && <span className="text-danger">{error}</span>}
      </div>
    </>
  );
}

export function ProposalDetail({ org, row, canReview }: { org: string; row: ProposalRow; canReview: boolean }) {
  if (row.source === "loop") return <LoopProposalDetail org={org} row={row} canReview={canReview} />;
  return (
    <>
      {row.rationale && <p className="max-w-3xl type-body-sm text-slate-300">{row.rationale}</p>}
      {row.explore.length > 0 && (
        <ul className="mt-2 space-y-1 type-body-sm text-slate-400">
          {row.explore.map((q, i) => (
            <li key={i} className="flex gap-2">
              <span className="select-none text-slate-600">→</span>
              <span>{q}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-4">
        <RowActions r={row} />
        {row.assigneeLogin && <span className="type-caption text-slate-500">owner {row.assigneeLogin}</span>}
        <span className="type-caption text-slate-600">id {row.id}</span>
      </div>
      <div className="mt-2 border-t border-divider pt-2">
        <FollowupHistory id={row.id} />
      </div>
    </>
  );
}
