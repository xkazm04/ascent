"use client";

// THE INTERRUPTED-RUNNER BANNER — CockpitDriveResume's counterpart for a standing runner a restart
// could not re-attach (spark theater-upgrade, 2026-09-18). The rail routes a continuous drive here
// because the drive banner's arithmetic ("2/3 runs spent", "1 run left") is about rope, and a runner
// has none: resuming it re-arms the SAME runner — scope, ceiling, dials — per `resumeParams`.
//
// Same design as the drive's: a banner above the inspector, never a mode, never auto-resumed — a
// runner spends agent sessions until stopped, and a server that re-armed one on boot would be
// spending the operator's money on the strength of a process having crashed. What it says out loud
// is what `resumeParams` does: per-repo pauses and streaks start fresh, and each repo's runner branch
// is picked up exactly where it is.

import { Kicker } from "@/components/ui";
import { RUNNER_BRANCH } from "@/lib/local/runner-types";
import { driveVerdict } from "./driveModel";
import { resumeParams, type DriveStatus } from "./driveTypes";

export interface CockpitRunnerResumeProps {
  drive: DriveStatus;
  onResume: () => void;
  onDismiss: () => void;
  busy?: boolean;
  error?: string | null;
}

export function CockpitRunnerResume({ drive, onResume, onDismiss, busy = false, error = null }: CockpitRunnerResumeProps) {
  const verdict = driveVerdict(drive);
  const resumable = resumeParams(drive) != null;
  return (
    <div data-testid="runner-interrupted" className="mb-3 rounded-md border border-warn/60 px-3 py-2.5">
      <Kicker tone="accent">Runner · {verdict.label}</Kicker>
      <p className="mt-1.5 type-body-sm leading-relaxed text-slate-400">{verdict.detail}</p>
      <p className="mt-1.5 type-caption leading-relaxed text-slate-500">
        Resuming re-arms the same runner — its scope, ceiling and dials. Per-repo pauses and streaks start fresh; each
        repo&apos;s {RUNNER_BRANCH} branch is picked up where it is.
      </p>
      {resumable && (
        <button
          type="button"
          data-testid="runner-resume"
          onClick={onResume}
          disabled={busy}
          className="focus-ring mt-3 w-full rounded-md border border-accent/60 px-3 py-2 type-label tracking-[0.18em] text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Resuming…" : "Resume runner"}
        </button>
      )}
      {error && <p className="mt-2 type-caption text-danger">{error}</p>}
      <button
        type="button"
        onClick={onDismiss}
        className="focus-ring mt-2 w-full rounded-md border border-divider px-3 py-1.5 type-label tracking-[0.18em] text-slate-400 transition hover:border-accent hover:text-white"
      >
        Dismiss
      </button>
    </div>
  );
}
