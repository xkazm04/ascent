// THE COCKPIT'S STARTS: every press that departs something, and the state each one clears first.
// Relocated out of `useCockpit` (backlog develop-2026-09-17 row 29) when the remote-agent arm joined
// them, so that hook stays the state machine and the four departures read as one list. No hooks here:
// `useCockpit` calls this each render with its own setters, exactly as the inline closures did.
//
// Every start clears the field's drift and a settled drive's verdict: both describe the PREVIOUS
// outcome, and a run departing under them would be drawn against a reading it has already made stale.

import { armedStartInput, type CockpitDispatchMode } from "./cockpitGate";
import type { CockpitDrift } from "./cockpitDrift";
import type { StartDriveInput } from "./driveClient";
import type { DriveStatus } from "./driveTypes";
import type { StartInput, StartLoopInput } from "./loopClient";
import type { CockpitMode, LoopRunRecord } from "./loopTypes";

export interface CockpitStartDeps {
  loop: { start: (input: StartInput) => Promise<LoopRunRecord | null> };
  drive: {
    start: (input: StartDriveInput) => Promise<DriveStatus | null>;
    resume: (id: string) => Promise<DriveStatus | null>;
  };
  dispatchMode: CockpitDispatchMode;
  setMode: (mode: CockpitMode) => void;
  setDrift: (drift: CockpitDrift | null) => void;
  setDriveOutcome: (status: DriveStatus | null) => void;
}

export function cockpitStarts(d: CockpitStartDeps) {
  const clear = () => {
    d.setDrift(null);
    d.setDriveOutcome(null);
  };
  // The rail flips to the run panel on the press and back to the inspector on a refusal.
  const launch = async (input: StartInput) => {
    d.setMode("run");
    clear();
    if (!(await d.loop.start(input))) d.setMode("inspect");
  };
  return {
    // The executor (and hosted's pr-only delivery) is stamped by the gate module; see armedStartInput.
    startRun: (input: StartLoopInput) => launch(armedStartInput(input, d.dispatchMode)),
    // THE REMOTE-AGENT ARM (row 29): the repos and nothing else, which is all the route's remote branch
    // reads. It is never stamped by `armedStartInput`: it is not a dispatch mode, and must not become one.
    armRemote: (repos: readonly string[]) => launch({ executor: "remote-agent", repos: [...repos] }),
    // Returns the adopted drive (null on a refusal); the setup dialog closes only on a started runner.
    startDrive: async (input: StartDriveInput) => {
      clear();
      return d.drive.start(input);
    },
    resumeDrive: async (interrupted: DriveStatus | null) => {
      if (!interrupted) return;
      clear();
      await d.drive.resume(interrupted.id);
    },
  };
}
