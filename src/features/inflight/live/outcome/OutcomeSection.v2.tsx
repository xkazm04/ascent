"use client";

// THE OUTCOME SURFACE, Prism composition (v2): TWO LEVELS instead of one wide sheet under the grid.
//   level 1 (the cockpit page) — what the runs added up to, said in one statement, and a run strip: one hairline row
//                                 per run (newest first), each a door to that run.
//   level 2 (`#outcome`)       — the full matrix, behind a breadcrumb, Back and Esc. The URL carries the level, so a
//                                 reload or a shared link lands in it and the browser Back button closes it.
// State is `useOutcomeMatrix` (the same review gate and fold v1 uses) and the body is `OutcomeBody`, so the sheet, its
// empty state and the drive verdict are one implementation. Opening a run from the strip opens the level too: a run
// replays into the field AND its column is in view.
import { Caption, Display, EscBack, Frame, GhostAction, LevelNav, SectionHead, useHashFlag } from "@/components/kit";
import { useEffect, useRef, type ReactNode } from "react";
import { DriveVerdict } from "../cockpit/CockpitDrivePanel";
import { OutcomeBody } from "./OutcomeBody";
import type { OutcomeSectionProps } from "./OutcomeSection";
import { OutcomeRunStrip } from "./OutcomeRunStrip.v2";
import { takeaway } from "./outcomeText";
import { useOutcomeMatrix } from "./useOutcomeMatrix";

export function OutcomeSectionV2(p: OutcomeSectionProps & { aside?: ReactNode }) {
  const [open, setOpen] = useHashFlag("outcome");
  const folded = useOutcomeMatrix(p);
  const { matrix } = folded;
  const heading = useRef<HTMLHeadingElement>(null);
  // A level below the overview takes focus when it opens: a keyboard user is not left on a button that is gone.
  useEffect(() => {
    if (open) heading.current?.focus({ preventScroll: true });
  }, [open]);

  if (open) {
    return (
      <Frame aria-label="Loop outcome, full matrix" pad="md">
        <EscBack onBack={() => setOpen(false)} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LevelNav trail={[{ label: "Live cockpit" }, { label: "Outcome" }]} back={{ label: "Cockpit", onClick: () => setOpen(false) }} />
          {p.aside}
        </div>
        <Display as="h2" level="section" id="outcome-title" className="mt-8 outline-none">
          <span ref={heading} tabIndex={-1} className="outline-none">
            {takeaway(matrix)}
          </span>
        </Display>
        <Caption className="mt-2">
          {matrix.totals.repos} {matrix.totals.repos === 1 ? "repo" : "repos"} · {matrix.totals.gaps} gaps no longer raised · drag a column edge to widen it. Esc goes back.
        </Caption>
        <div className="mt-6 space-y-3">
          <OutcomeBody p={p} {...folded} />
        </div>
      </Frame>
    );
  }

  return (
    <Frame aria-label="Loop outcome" pad="md">
      <SectionHead
        eyebrow="Outcome"
        title={takeaway(matrix)}
        level="section"
        actions={
          matrix.columns.length > 0 ? (
            <GhostAction onClick={() => setOpen(true)} aria-label="Open the full outcome matrix">
              Open the matrix →
            </GhostAction>
          ) : undefined
        }
      />
      {p.driveOutcome && (
        <div className="mt-6">
          <DriveVerdict drive={p.driveOutcome} onBack={p.onDismissDrive} />
        </div>
      )}
      <div className="mt-6">
        {matrix.columns.length === 0 ? (
          <Caption tone="note">No runs yet — select repos in the sky and start a run. Each run will land here as a row.</Caption>
        ) : (
          <OutcomeRunStrip
            columns={matrix.columns}
            selectedId={p.selectedId}
            nowMs={p.nowMs}
            onOpen={(id) => {
              p.onOpen(id);
              setOpen(true);
            }}
          />
        )}
      </div>
    </Frame>
  );
}
