"use client";

// The outcome surface's BODY — the pending-proposals pointer, a review error, the drive verdict, the sheet (or its
// empty state) and the agent's per-item account — shared by both compositions of the section: v1 puts it under a
// hairline caption, v2 puts it one level down (behind `#outcome`), under a breadcrumb. One implementation, so the
// review gate and the honest empty state cannot differ between themes.
import Link from "next/link";
import { orgTabHref } from "@/lib/org/orgTabs";
import { DriveVerdict } from "../cockpit/CockpitDrivePanel";
import { CockpitVerdicts } from "../cockpit/CockpitVerdicts";
import type { OutcomeSectionProps } from "./OutcomeSection";
import { OutcomeSheet } from "./OutcomeSheet";
import type { OutcomeMatrix } from "./outcomeMatrix";
import type { useOutcomeMatrix } from "./useOutcomeMatrix";

type Folded = ReturnType<typeof useOutcomeMatrix>;

export function OutcomeBody({ p, matrix, pending, onReview, reviewError }: { p: OutcomeSectionProps; matrix: OutcomeMatrix } & Omit<Folded, "matrix">) {
  const { slug } = p;
  // The agent's per-item account for the run on screen — shown only when the run recorded one, so an
  // empty panel never sits under a full sheet.
  const onScreen = p.openedDetail ?? p.liveDetail;
  const itemOutcomes = onScreen?.itemOutcomes ?? [];
  return (
    <>
      {pending > 0 && (
        <Link href={orgTabHref(slug, "proposals")} className="focus-ring inline-block rounded type-caption text-accent hover:text-white">
          <span className="tabular-nums">{pending}</span> {pending === 1 ? "proposal awaits" : "proposals await"} review — decide them in Proposals →
        </Link>
      )}
      {reviewError && <p className="type-caption text-danger">{reviewError}</p>}
      {p.driveOutcome && <DriveVerdict drive={p.driveOutcome} onBack={p.onDismissDrive} />}
      {matrix.columns.length === 0 ? (
        <p className="type-body-sm rounded-2xl border border-dashed border-divider px-4 py-6 text-center text-slate-400">
          No runs yet — select repos in the sky and start a run. Each run will land here as a column.
        </p>
      ) : (
        <OutcomeSheet
          matrix={matrix}
          slug={slug}
          selectedId={p.selectedId}
          onOpen={p.onOpen}
          canReview={p.canReview}
          onReview={onReview}
          nowMs={p.nowMs}
        />
      )}
      {itemOutcomes.length > 0 && <CockpitVerdicts outcomes={itemOutcomes} titles={onScreen?.batchTitles} />}
    </>
  );
}
