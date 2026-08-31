"use client";

// THE LOOP COCKPIT — the Live tab's default view. One dominant object (the observatory) and one
// right rail that is only ever showing ONE thing: what you have selected, what is running, or what a
// run did. The rail's mode is derived from the run's own lifecycle rather than from a tab bar,
// because at any moment exactly one of those three is the interesting question.
//
// A DRIVE is a fourth: a sequence of runs re-measured against the fleet's own green predicate after
// every one of them (src/lib/local/drive.ts). It outranks the run mode while it is pulling, because
// during a drive the interesting question is "is debt falling and how much rope is left", not "what
// is this one run doing" — and it settles into the SAME outcome ledger a single run does, with a
// verdict banner above it saying which of the three honest stops ended it.
//
// THE RAIL NEVER ENTERS OUTCOME MODE (wave-2). The outcome is a full-width SHEET under the grid
// (`OutcomeSection`) — one row per gap, one column per run — which also absorbed the history strip's
// job. A settled run still drifts the field and is still `setOutcome`'d; the rail simply keeps showing
// the inspector, with the selection intact, because the outcome now has a better place to be.
//
// This file is layout only: the state machine is useCockpit, the rail's panel choice is CockpitRail.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Surface } from "@/components/ui";
import { reportPermalink } from "@/lib/ui";
import type { ObservatoryHistory, ObservatorySeed } from "../observatory";
import { OutcomeSection } from "../outcome/OutcomeSection";
import { CockpitField } from "./CockpitField";
import { CockpitHeader } from "./CockpitHeader";
import { CockpitRail } from "./CockpitRail";
import { PriceListPanel } from "./PriceListPanel";
import { CockpitLessons } from "./CockpitLessons";
import { useCockpit } from "./useCockpit";
import type { LoopRunDetail, LoopRunRecord, LoopRunSummary } from "./loopTypes";

export interface LiveCockpitProps {
  slug: string;
  /** The scoped fleet standing — the same seeds the wall gets, plus `scannedAt`. */
  seeds: ObservatorySeed[];
  histories: ObservatoryHistory[];
  /** Repos with a local pairing; empty on managed cloud. */
  pairedRepos: string[];
  activeRun: LoopRunRecord | null;
  runs: LoopRunSummary[];
  /** The details of the listed runs (bounded), for the outcome matrix. Empty on managed cloud. */
  runDetails?: LoopRunDetail[];
  /** `autopilotEnabled()` at render time — the ASCENT_AUTOPILOT gate. */
  loopEnabled: boolean;
  selfHosted: boolean;
  isOwner: boolean;
  /** `?view=wall`, with the tab's other params preserved. */
  wallHref: string;
}

const NO_DETAILS: LoopRunDetail[] = [];

export function LiveCockpit(props: LiveCockpitProps) {
  const { slug, seeds, isOwner, wallHref, runDetails = NO_DETAILS } = props;
  const router = useRouter();
  const [listOpen, setListOpen] = useState(true);
  const c = useCockpit(props);
  const { loop, drive } = c;
  // `outcome` is still a real mode of the state machine (it suppresses the interrupted-drive offer and
  // marks the opened run), but the RAIL has no panel for it: it shows the inspector instead.
  const railMode = c.mode === "outcome" ? "inspect" : c.mode;

  return (
    <section aria-label="Loop cockpit" className="space-y-4">
      <CockpitHeader
        fleetCount={seeds.length}
        active={loop.active}
        laneCount={c.laneCount}
        live={loop.live || drive.live}
        driveCaption={drive.live && drive.drive ? `drive · run ${drive.drive.runs.length}/${drive.drive.maxRuns}` : null}
        wallHref={wallHref}
        onStop={c.stop}
        stopping={loop.busy || drive.busy}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,1.4fr)]">
        <CockpitField
          bodies={c.bodies}
          selected={c.selected}
          onSelect={c.setSelected}
          scanning={c.scanning}
          drift={c.drift}
          onOpen={(fullName) => router.push(reportPermalink(fullName, null, slug))}
          listOpen={listOpen}
          onToggleList={() => setListOpen(!listOpen)}
        />

        <Surface className="min-w-0 p-4">
          <CockpitRail
            slug={slug}
            mode={railMode}
            setup={c.setup}
            liveDrive={drive.live ? drive.drive : null}
            interruptedDrive={c.interruptedDrive}
            runDetail={loop.detail}
            runLive={loop.live}
            selected={c.selected}
            paired={c.paired}
            propose={loop.propose}
            canRun={isOwner && loop.enabled}
            prAvailable={loop.prAvailable}
            busy={loop.busy || drive.busy}
            loopError={loop.error}
            driveError={drive.error}
            onRun={(input) => void c.startRun(input)}
            onDrive={(input) => void c.startDrive(input)}
            onStopRun={() => loop.activeId && void loop.stop(loop.activeId)}
            onStopDrive={() => void drive.stop()}
            onResumeDrive={() => void c.resumeDrive()}
            onDismissDrive={c.dismissDrive}
            onRetryLane={(laneId) => void loop.retry(laneId)}
          />
        </Surface>
      </div>

      <OutcomeSection
        slug={slug}
        canReview={isOwner}
        runDetails={runDetails}
        liveDetail={loop.detail}
        openedDetail={c.outcome}
        selectedId={c.outcome?.run.id ?? loop.activeId}
        driveOutcome={c.driveOutcome}
        onOpen={(id) => void c.openRun(id)}
        onDismissDrive={c.backToInspect}
      />
      {/* What a verified maturity point has cost, per model, per dimension — the standing summary
          the strip's individual runs add up to. */}
      <PriceListPanel slug={slug} />
      {/* Lesson candidates from the loop's agents — a review queue, not a reading. */}
      <CockpitLessons slug={slug} />
    </section>
  );
}
