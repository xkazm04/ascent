"use client";

// THE OUTCOME SECTION — full width under the observatory grid. It absorbs the old history strip's job
// (every column header opens that run on the field) and the rail's outcome mode (the deliverables are
// the cells). One takeaway sentence leads; the variant below it is the matrix in one of two metaphors.

import { useMemo } from "react";
import { Kicker } from "@/components/ui";
import { DriveVerdict } from "../cockpit/CockpitDrivePanel";
import type { DriveStatus } from "../cockpit/driveTypes";
import type { LoopRunDetail } from "../cockpit/loopTypes";
import { buildOutcomeMatrix, mergeRunDetails } from "./outcomeMatrix";
import { OutcomeRegister } from "./OutcomeRegister";
import { OutcomeStoryboard } from "./OutcomeStoryboard";
import { takeaway } from "./outcomeText";

export type OutcomeVariant = "register" | "storyboard";

export interface OutcomeSectionProps {
  variant: OutcomeVariant;
  /** The SSR snapshot of the listed runs' details. */
  runDetails: LoopRunDetail[];
  /** The live or just-settled detail from the poll, and the run the operator opened — both outrank the snapshot. */
  liveDetail: LoopRunDetail | null;
  openedDetail: LoopRunDetail | null;
  selectedId: string | null;
  driveOutcome: DriveStatus | null;
  onOpen: (id: string) => void;
  onDismissDrive: () => void;
}

export function OutcomeSection(p: OutcomeSectionProps) {
  const matrix = useMemo(
    () => buildOutcomeMatrix(mergeRunDetails(p.runDetails, p.openedDetail, p.liveDetail)),
    [p.runDetails, p.openedDetail, p.liveDetail],
  );
  const Variant = p.variant === "register" ? OutcomeRegister : OutcomeStoryboard;
  return (
    <section aria-label="Loop outcome" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-divider pb-2">
        <div className="min-w-0">
          <Kicker tone="accent">Outcome</Kicker>
          <h3 className="type-title mt-0.5 font-semibold tracking-tight text-slate-100">{takeaway(matrix)}</h3>
        </div>
        {matrix.columns.length > 0 && (
          <span className="type-caption tabular-nums text-slate-500">
            {matrix.totals.repos} {matrix.totals.repos === 1 ? "repo" : "repos"} · {matrix.totals.gaps} gaps closed · click a run to widen it
          </span>
        )}
      </div>
      {p.driveOutcome && <DriveVerdict drive={p.driveOutcome} onBack={p.onDismissDrive} />}
      {matrix.columns.length === 0 ? (
        <p className="type-body-sm rounded-2xl border border-dashed border-divider px-4 py-6 text-center text-slate-400">
          No runs yet — select repos in the sky and start a run. Each run will land here as a column.
        </p>
      ) : (
        <Variant matrix={matrix} selectedId={p.selectedId} onOpen={p.onOpen} />
      )}
    </section>
  );
}
