"use client";

// WHAT THE DIALOG IS ARMING — one run, a bounded drive, or the standing runner (spark theater-upgrade,
// 2026-09-18). The three are one experiment armed three ways, so they share every dial; the mode
// decides which of the mode-specific ones are shown (the drive's rope, the runner's ceiling) and what
// the footer can do. Run and Drive dispatch from the inspector, over the selection; the runner is
// started from the dialog itself, because it runs until stopped and its ceiling belongs in view.

import { Segmented } from "./RunSetupControls";
import type { SetupSectionProps } from "./RunSetupSections";
import type { SetupMode } from "./useRunDials";

const MODES: readonly SetupMode[] = ["run", "drive", "runner"];

export const MODE_LABELS: Record<SetupMode, string> = {
  run: "Run",
  drive: "Drive to green",
  runner: "Standing runner",
};

const MODE_HINTS: Record<SetupMode, string> = {
  run: "One run over the repos you select. Start it from the inspector's Run.",
  drive:
    "Runs again and again over your selection until it is green, a whole run moves nothing, or the rope is spent. Start it from the inspector's Drive to green.",
  runner: "Runs until you stop it, pausing on named breakers rather than ending. Started from this dialog.",
};

export function ModeSection({ dials, onChange }: SetupSectionProps) {
  return (
    <div>
      <Segmented
        ariaLabel="What this setup arms"
        testId="setup-mode"
        value={dials.mode}
        onChange={(v) => onChange("mode", v)}
        options={MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
      />
      <p className="mt-2 type-note leading-relaxed text-slate-500">{MODE_HINTS[dials.mode]}</p>
    </div>
  );
}
