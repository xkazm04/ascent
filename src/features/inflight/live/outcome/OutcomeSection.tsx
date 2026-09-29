"use client";

// THE OUTCOME SECTION — full width under the observatory grid, and THE outcome surface: the rail no
// longer has an outcome mode and there is no second variant to switch to. It absorbs the old history
// strip's job (every run column opens that run and drifts the field) and the old rail ledger's
// (the gaps are the rows).
//
// The review gate lives here: an owner's ✓/✕ on a cell POSTs through `reviewLoopDeliverable`, then
// the run's detail is refetched so the ruling renders from the store, not from a client guess.

import { Kicker } from "@/components/ui";
import type { DriveStatus } from "../cockpit/driveTypes";
import type { LoopRunDetail } from "../cockpit/loopTypes";
import { OutcomeBody } from "./OutcomeBody";
import { useOutcomeMatrix } from "./useOutcomeMatrix";
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
  /** The page's own instant (the server's render time), so a column's age does not differ between
   *  the server render and the hydrated one. */
  nowMs?: number;
}

export function OutcomeSection(p: OutcomeSectionProps) {
  const { matrix, pending, onReview, reviewError } = useOutcomeMatrix(p);
  return (
    <section aria-label="Loop outcome" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-divider pb-2">
        <div className="min-w-0">
          <Kicker tone="accent">Outcome</Kicker>
          <h3 className="type-title mt-0.5 font-semibold tracking-tight text-slate-100">{takeaway(matrix)}</h3>
        </div>
        {matrix.columns.length > 0 && (
          <span className="type-caption tabular-nums text-slate-500">
            {/* `totals.gaps` is `diff.closedGapCount`, a SCAN-DIFF quantity — not the lanes' adjudicated
                close count and not a follow-up verdict. Its own words, so "closed" keeps meaning one
                thing on this page (MC-B41). */}
            {matrix.totals.repos} {matrix.totals.repos === 1 ? "repo" : "repos"} · {matrix.totals.gaps} gaps no longer
            raised · drag a column edge to widen it
          </span>
        )}
      </div>
      <OutcomeBody p={p} matrix={matrix} pending={pending} onReview={onReview} reviewError={reviewError} />
    </section>
  );
}
