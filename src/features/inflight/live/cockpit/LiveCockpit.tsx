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
// This file is layout only: the state machine is useCockpit, the rail's panel choice is CockpitRail.
//
// The wall this replaces is still one link away (`?view=wall`) and is untouched — including the
// kiosk route that renders it read-only.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Surface } from "@/components/ui";
import { reportPermalink } from "@/lib/ui";
import type { ObservatoryHistory, ObservatorySeed } from "../observatory";
import { CockpitField } from "./CockpitField";
import { CockpitHeader } from "./CockpitHeader";
import { CockpitHistory } from "./CockpitHistory";
import { CockpitRail } from "./CockpitRail";
import { useCockpit } from "./useCockpit";
import type { LoopRunRecord, LoopRunSummary } from "./loopTypes";

export interface LiveCockpitProps {
  slug: string;
  /** The scoped fleet standing — the same seeds the wall gets, plus `scannedAt`. */
  seeds: ObservatorySeed[];
  histories: ObservatoryHistory[];
  /** Repos with a local pairing; empty on managed cloud. */
  pairedRepos: string[];
  activeRun: LoopRunRecord | null;
  runs: LoopRunSummary[];
  /** `autopilotEnabled()` at render time — the ASCENT_AUTOPILOT gate. */
  loopEnabled: boolean;
  selfHosted: boolean;
  isOwner: boolean;
  /** `?view=wall`, with the tab's other params preserved. */
  wallHref: string;
}

export function LiveCockpit(props: LiveCockpitProps) {
  const { slug, seeds, isOwner, wallHref } = props;
  const router = useRouter();
  const [listOpen, setListOpen] = useState(true);
  const c = useCockpit(props);
  const { loop, drive } = c;

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
            mode={c.mode}
            setup={c.setup}
            liveDrive={drive.live ? drive.drive : null}
            driveOutcome={c.driveOutcome}
            runDetail={loop.detail}
            runLive={loop.live}
            outcome={c.outcome}
            canReplay={c.drift != null}
            selected={c.selected}
            paired={c.paired}
            propose={loop.propose}
            canRun={isOwner && loop.enabled}
            busy={loop.busy || drive.busy}
            loopError={loop.error}
            driveError={drive.error}
            onRun={(input) => void c.startRun(input)}
            onDrive={(input) => void c.startDrive(input)}
            onStopRun={() => loop.activeId && void loop.stop(loop.activeId)}
            onStopDrive={() => void drive.stop()}
            onRetryLane={(laneId) => void loop.retry(laneId)}
            onReplay={c.replayRun}
            onBack={c.backToInspect}
          />
        </Surface>
      </div>

      <CockpitHistory runs={loop.runs} selectedId={c.outcome?.run.id ?? loop.activeId} onOpen={(id) => void c.openRun(id)} />
    </section>
  );
}
