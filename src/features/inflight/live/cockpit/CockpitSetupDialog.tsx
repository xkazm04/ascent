"use client";

// THE SETUP DIALOG, WIRED — the one place the cockpit's state machine meets `RunSetupModal`
// (spark theater-upgrade, 2026-09-18). Extracted from LiveCockpit so the layout stays layout: this is
// where the STANDING RUNNER is started, because it is the one start that belongs in the dialog (it
// runs until stopped, so the operator starts it with the ceiling and the forced settings in view).
//
// The request is `runnerStartInput` — the same pure composition the tests pin — sent through the same
// `startDrive` the inspector's Drive uses, so a runner and a drive share one start path, one error
// surface and one poll. The dialog closes only when the server accepted the runner; a refusal (a
// drive already on, a ceiling past the deployment's bound) stays on screen, verbatim.

import { RunSetupModal } from "./RunSetupModal";
import { runnerStartInput } from "./startInputs";
import type { useCockpit } from "./useCockpit";

type Cockpit = ReturnType<typeof useCockpit>;

/** The one reason a runner cannot start that the browser can see for itself. */
export const RUNNER_BLOCKED = "A drive or a standing runner is already on for this organization — stop it first.";

export interface CockpitSetupDialogProps {
  c: Cockpit;
  open: boolean;
  onClose: () => void;
  /** The runner's default scope as this page knows it: every watched repo with a paired checkout. */
  runnerRepos: readonly string[];
}

export function CockpitSetupDialog({ c, open, onClose, runnerRepos }: CockpitSetupDialogProps) {
  const { dials, batch, drive, loop } = c;

  const startRunner = async () => {
    const built = runnerStartInput(dials, batch.runnable);
    if (!built.ok) return;
    if (await c.startDrive(built.input)) onClose();
  };

  return (
    <RunSetupModal
      open={open}
      onClose={onClose}
      dials={dials}
      onChange={c.setDial}
      dims={batch.dims}
      prAvailable={loop.prAvailable}
      runner={{
        repos: runnerRepos,
        selection: batch.runnable,
        onStart: () => void startRunner(),
        busy: drive.busy,
        error: drive.error,
        blocked: drive.live ? RUNNER_BLOCKED : null,
      }}
    />
  );
}
