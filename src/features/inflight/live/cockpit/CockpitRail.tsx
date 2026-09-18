"use client";

// THE RIGHT RAIL — the one place that decides which of the four panels the operator is looking at.
// Extracted from LiveCockpit so the decision is readable as a single ordered list rather than as a
// nested ternary buried in a layout; the order IS the doctrine:
//
//   1. a live DRIVE outranks everything — while it pulls, "is debt falling and how much rope is left"
//      is the only question, and its own runs come and go underneath it. A live STANDING RUNNER is a
//      drive too (a `continuous` one), and `CockpitDrivePanel` hands it to the runner panel;
//   2. a live single run;
//   3. a setup block naming the one thing missing before anything can be dispatched;
//   4. otherwise the inspector — with an INTERRUPTED drive's resume offer as a banner above it, not
//      in place of it: a drive a restart orphaned is a standing offer, and the operator is equally
//      entitled to ignore it and select a different scope. An interrupted RUNNER gets its own banner,
//      because the drive banner's words are about rope and a runner has none.
//
// THERE IS NO OUTCOME PANEL (wave-2). A settled run's outcome is the full-width SHEET under the grid
// (`OutcomeSection`), and a settled DRIVE's verdict banner rides above it there. The rail keeps the
// inspector — and the selection — so the run you just watched is still the scope you can iterate on.
// `mode` may still arrive as `"outcome"`; it renders exactly as `"inspect"`.

import { CockpitDrivePanel } from "./CockpitDrivePanel";
import { CockpitDriveResume } from "./CockpitDriveResume";
import { CockpitInspector } from "./CockpitInspector";
import { CockpitRunnerResume } from "./CockpitRunnerResume";
import { CockpitRunPanel } from "./CockpitRunPanel";
import { CockpitSetup, type CockpitSetupState } from "./CockpitSetup";
import type { StartDriveInput } from "./driveClient";
import type { DriveStatus } from "./driveTypes";
import type { StartLoopInput } from "./loopClient";
import type { CockpitMode, LoopRunDetail } from "./loopTypes";
import { isRunner } from "./runnerModel";
import type { ProposalBatch } from "./useProposalBatch";
import type { RunDials } from "./useRunDials";

export interface CockpitRailProps {
  slug: string;
  mode: CockpitMode;
  /** The blocking setup state, or null when this deployment can dispatch. */
  setup: CockpitSetupState | null;
  /** The drive currently pulling, if any — it outranks every other panel. */
  liveDrive: DriveStatus | null;
  /** A drive a server restart orphaned, offered back to the operator above the inspector. */
  interruptedDrive: DriveStatus | null;
  runDetail: LoopRunDetail | null;
  runLive: boolean;
  /** The selection's proposals and pruning (`useCockpit`) — the inspector's CTA dispatches from it. */
  batch: ProposalBatch;
  /** The armed run configuration, written by the setup dialog behind the masthead's gear. */
  dials: RunDials;
  canRun: boolean;
  busy: boolean;
  loopError: string | null;
  driveError: string | null;
  onRun: (input: StartLoopInput) => void;
  onDrive: (input: StartDriveInput) => void;
  /** Open the setup dialog in standing-runner mode (the inspector's third CTA). */
  onOpenRunner?: () => void;
  onStopRun: () => void;
  onStopDrive: () => void;
  onResumeDrive: () => void;
  onDismissDrive: () => void;
  onRetryLane: (laneId: string) => void;
  /** Lift one repo's pause on the live runner. */
  onResumeRepo?: (repo: string) => void;
}

export function CockpitRail(props: CockpitRailProps) {
  const { mode, setup, liveDrive, runDetail, runLive, interruptedDrive } = props;

  if (liveDrive) {
    return (
      <CockpitDrivePanel
        drive={liveDrive}
        runDetail={runDetail}
        onStop={props.onStopDrive}
        onResumeRepo={props.onResumeRepo}
        busy={props.busy}
        error={props.driveError}
      />
    );
  }
  if (mode === "run") {
    return (
      <CockpitRunPanel
        detail={runDetail}
        live={runLive}
        onStop={props.onStopRun}
        onRetry={props.onRetryLane}
        busy={props.busy}
        error={props.loopError}
      />
    );
  }
  if (setup) return <CockpitSetup state={setup} slug={props.slug} message={props.loopError} />;
  const Banner = isRunner(interruptedDrive) ? CockpitRunnerResume : CockpitDriveResume;
  return (
    <>
      {interruptedDrive && (
        <Banner
          drive={interruptedDrive}
          onResume={props.onResumeDrive}
          onDismiss={props.onDismissDrive}
          busy={props.busy}
          error={props.driveError}
        />
      )}
      <CockpitInspector
        batch={props.batch}
        dials={props.dials}
        onRun={props.onRun}
        onDrive={props.onDrive}
        onOpenRunner={props.onOpenRunner}
        canRun={props.canRun}
        busy={props.busy}
        // The interrupted banner already owns the drive error; showing it twice would read as two
        // failures.
        error={interruptedDrive ? null : props.driveError}
      />
    </>
  );
}
