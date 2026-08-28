"use client";

// THE INTERRUPTED-DRIVE BANNER — what the cockpit shows when a drive was pulling and the server it
// was pulling from went away.
//
// It is a BANNER above the inspector rather than a mode of its own, and that is the whole design
// decision. An interrupted drive is not a live thing to watch and not an outcome to read; it is a
// standing offer. The operator may take it, or ignore it and select a different scope — so the
// inspector has to stay reachable underneath.
//
// NOT AUTO-RESUMED, and the copy says so out loud. A drive spends agent sessions inside real working
// copies; a server that re-armed one by itself on boot would be spending the operator's money on the
// strength of a process having crashed. The runs it already finished ARE durable — their commits,
// branches and rescans stand — and the resume continues against the same budget rather than granting
// a fresh one, which is the sentence this banner exists to make true on screen.

import { Kicker } from "@/components/ui";
import { driveResume, driveVerdict } from "./driveModel";
import type { DriveStatus } from "./driveTypes";

export interface CockpitDriveResumeProps {
  drive: DriveStatus;
  onResume: () => void;
  onDismiss: () => void;
  busy?: boolean;
  error?: string | null;
}

export function CockpitDriveResume({ drive, onResume, onDismiss, busy = false, error = null }: CockpitDriveResumeProps) {
  const verdict = driveVerdict(drive);
  const resume = driveResume(drive);

  return (
    <div data-testid="drive-interrupted" className="mb-3 rounded-md border border-warn/60 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Drive · {verdict.label}</Kicker>
        <span className="font-mono text-xs tabular-nums text-slate-500">
          {resume ? `${resume.runsDone}/${drive.maxRuns} runs spent` : `${drive.maxRuns}/${drive.maxRuns} runs spent`}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{verdict.detail}</p>

      {resume ? (
        <button
          type="button"
          data-testid="drive-resume"
          onClick={onResume}
          disabled={busy}
          className="focus-ring mt-3 w-full rounded-md border border-accent/60 px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Resuming…" : `Resume drive (${resume.runsLeft} ${resume.runsLeft === 1 ? "run" : "runs"} left)`}
        </button>
      ) : (
        <p className="mt-3 font-mono text-xs text-slate-500">
          The run budget is spent — start a fresh drive with more rope to keep going.
        </p>
      )}

      {error && <p className="mt-2 font-mono text-xs text-danger">{error}</p>}

      <button
        type="button"
        data-testid="drive-dismiss"
        onClick={onDismiss}
        className="focus-ring mt-2 w-full rounded-md border border-divider px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-slate-400 transition hover:border-accent hover:text-white"
      >
        Dismiss
      </button>
    </div>
  );
}
