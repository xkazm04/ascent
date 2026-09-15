"use client";

// THE RIGHT RAIL — the one place that decides which of the four panels the operator is looking at.
// Extracted from LiveCockpit so the decision is readable as a single ordered list rather than as a
// nested ternary buried in a layout; the order IS the doctrine:
//
//   1. a live DRIVE outranks everything — while it pulls, "is debt falling and how much rope is left"
//      is the only question, and its own runs come and go underneath it;
//   2. a live single run;
//   3. a setup block naming the one thing missing before anything can be dispatched;
//   4. otherwise the inspector — with an INTERRUPTED drive's resume offer as a banner above it, not
//      in place of it: a drive a restart orphaned is a standing offer, and the operator is equally
//      entitled to ignore it and select a different scope.
//
// THERE IS NO OUTCOME PANEL (wave-2). A settled run's outcome is the full-width SHEET under the grid
// (`OutcomeSection`), and a settled DRIVE's verdict banner rides above it there. The rail keeps the
// inspector — and the selection — so the run you just watched is still the scope you can iterate on.
// `mode` may still arrive as `"outcome"`; it renders exactly as `"inspect"`.

import { CockpitDrivePanel } from "./CockpitDrivePanel";
import { CockpitDriveResume } from "./CockpitDriveResume";
import { CockpitInspector } from "./CockpitInspector";
import { CockpitRunPanel } from "./CockpitRunPanel";
import { CockpitSetup, type CockpitSetupState } from "./CockpitSetup";
import type { StartDriveInput } from "./driveClient";
import type { DriveStatus } from "./driveTypes";
import type { StartLoopInput } from "./loopClient";
import type { CockpitMode, LoopProposal, LoopRunDetail } from "./loopTypes";

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
  selected: ReadonlySet<string>;
  paired: ReadonlySet<string>;
  propose: (repos: readonly string[]) => Promise<LoopProposal[] | null>;
  canRun: boolean;
  /** Whether a PR can be opened on this deployment at all — passed straight to the delivery dial. */
  prAvailable?: boolean;
  busy: boolean;
  loopError: string | null;
  driveError: string | null;
  onRun: (input: StartLoopInput) => void;
  onDrive: (input: StartDriveInput) => void;
  onStopRun: () => void;
  onStopDrive: () => void;
  onResumeDrive: () => void;
  onDismissDrive: () => void;
  onRetryLane: (laneId: string) => void;
}

export function CockpitRail(props: CockpitRailProps) {
  const { mode, setup, liveDrive, runDetail, runLive } = props;

  if (liveDrive) {
    return (
      <CockpitDrivePanel
        drive={liveDrive}
        runDetail={runDetail}
        onStop={props.onStopDrive}
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
  return (
    <>
      {props.interruptedDrive && (
        <CockpitDriveResume
          drive={props.interruptedDrive}
          onResume={props.onResumeDrive}
          onDismiss={props.onDismissDrive}
          busy={props.busy}
          error={props.driveError}
        />
      )}
      <CockpitInspector
        selected={props.selected}
        paired={props.paired}
        propose={props.propose}
        onRun={props.onRun}
        onDrive={props.onDrive}
        canRun={props.canRun}
        prAvailable={props.prAvailable}
        busy={props.busy}
        // The interrupted banner already owns the drive error; showing it twice would read as two
        // failures.
        error={props.interruptedDrive ? null : props.driveError}
      />
    </>
  );
}
