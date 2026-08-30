"use client";

// THE OUTCOME SECTION — full width under the observatory grid. It absorbs the old history strip's job
// (every run header opens that run on the field) and the rail's outcome mode (the deliverables are
// the rows). Round 1 kept the Storyboard; round 2 adds two variants that differ on what the screen is
// FOR — "Release notes" persuades (a changelog the director can forward), "Earned another run" decides
// (one verdict, the rows that justify it). Those two lead with their own sentence, so the section's
// eyebrow and takeaway line are Storyboard's alone — a second title above a title is a tie.

import { useMemo } from "react";
import { Kicker } from "@/components/ui";
import { DriveVerdict } from "../cockpit/CockpitDrivePanel";
import type { DriveStatus } from "../cockpit/driveTypes";
import type { LoopRunDetail } from "../cockpit/loopTypes";
import { OutcomeEarned } from "./OutcomeEarned";
import { OutcomeReleaseNotes } from "./OutcomeReleaseNotes";
import { OutcomeStoryboard } from "./OutcomeStoryboard";
import { buildOutcomeMatrix, mergeRunDetails } from "./outcomeMatrix";
import { takeaway } from "./outcomeText";

export type OutcomeVariant = "storyboard" | "release-notes" | "earned";

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
  const storyboard = p.variant === "storyboard";
  const variantProps = { matrix, selectedId: p.selectedId, onOpen: p.onOpen };
  return (
    <section aria-label="Loop outcome" className="space-y-3">
      {storyboard && (
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
      )}
      {p.driveOutcome && <DriveVerdict drive={p.driveOutcome} onBack={p.onDismissDrive} />}
      {p.variant === "release-notes" ? (
        <OutcomeReleaseNotes {...variantProps} />
      ) : p.variant === "earned" ? (
        <OutcomeEarned {...variantProps} />
      ) : matrix.columns.length === 0 ? (
        <p className="type-body-sm rounded-2xl border border-dashed border-divider px-4 py-6 text-center text-slate-400">
          No runs yet — select repos in the sky and start a run. Each run will land here as a column.
        </p>
      ) : (
        <OutcomeStoryboard {...variantProps} />
      )}
    </section>
  );
}
