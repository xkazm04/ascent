"use client";

// RUNNER mode — the right rail while a STANDING RUNNER (a `continuous` drive) is on (spark
// theater-upgrade, 2026-09-18). `CockpitDrivePanel` hands a continuous drive here, because a runner
// answers different questions from a drive: not "how much rope is left, is debt falling" but "is it
// working or waiting — and if waiting, on what and until when", what it has landed, and which repos
// are held.
//
// No "run N of M" (there is no M), no debt bar (there is no target), no green/dry/ceiling words.
// The phase line is `runnerPhase` — Running · Paused — spend ceiling until 00:00 · Idle — next repo
// wakes 14:20 — and a pause carries the breaker's own sentence underneath (`pauseNote`).
//
// SPEND TODAY IS NOT HERE, on purpose rather than by omission: the drive status carries the CEILING
// (`spendCeilingMicros`) but no spend-so-far figure, and a number this panel invented from its own
// arithmetic would disagree with the one the breaker acts on. The pause note, when the ceiling fires,
// quotes the server's own figure. The Theater's TODAY strip reads spend from the pulse.
//
// STOP SAYS WHAT IT DOES (`runnerStopHint`): a waiting runner stops at its next beat; a working one
// stops the run it is waiting on. Either way the verified work already on the runner branch stays.

import { Kicker } from "@/components/ui";
import { TILE_LEDGER } from "@/components/org/shared/ui";
import { DriveRunRow } from "./CockpitDriveRunRow";
import { CockpitRunnerRepos } from "./CockpitRunnerRepos";
import { driveProgress } from "./driveModel";
import type { DriveStatus } from "./driveTypes";
import type { LoopRunDetail } from "./loopTypes";
import { pauseNote, runnerFigures, runnerPhase, runnerRepoRows, runnerStopHint, type RunnerTone } from "./runnerModel";

export const STOPPING_RUNNER_LABEL = "Stopping the runner…";
/** How many of the runner's runs the rail lists; the Ledger carries the whole chronicle. */
const RECENT_RUNS = 5;

const PHASE_CLASS: Record<RunnerTone, string> = {
  live: "text-accent",
  warn: "text-warn",
  muted: "text-slate-400",
  danger: "text-danger",
};

const CEILING_TITLE =
  "Once today's agent spend reaches the ceiling, the whole runner pauses until local midnight (server time). The session-limit breaker is always on, ceiling or not.";

export interface CockpitRunnerPanelProps {
  drive: DriveStatus;
  /** The loop run the runner is waiting on, from useLoopRun's own poll — the per-lane detail. */
  runDetail: LoopRunDetail | null;
  onStop: () => void;
  /** Lift one repo's pause (`resume-repo`). */
  onResumeRepo?: (repo: string) => void;
  busy?: boolean;
  error?: string | null;
}

export function CockpitRunnerPanel({ drive, runDetail, onStop, onResumeRepo, busy = false, error = null }: CockpitRunnerPanelProps) {
  const phase = runnerPhase(drive);
  const f = runnerFigures(drive);
  const p = driveProgress(drive);
  const inFlight = p.currentRunId && runDetail?.run.id === p.currentRunId ? runDetail : null;
  const note = pauseNote(drive);
  const live = p.live;
  const recent = drive.runs
    .map((record, i) => ({ record, index: drive.runsBefore + i }))
    .slice(-RECENT_RUNS)
    .reverse();

  return (
    <div data-testid="runner-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Standing runner</Kicker>
        {f.uptime && <span className="type-caption tabular-nums text-slate-500">up {f.uptime}</span>}
      </div>

      <p data-testid="runner-phase" className={`mt-2 inline-flex items-center gap-1.5 type-body-sm font-medium ${PHASE_CLASS[phase.tone]}`}>
        {phase.tone === "live" && <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />}
        {phase.label}
      </p>
      {note && <p className="mt-1 type-caption leading-relaxed text-slate-400">{note}</p>}

      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 type-caption tabular-nums text-slate-500">
        <span>
          {f.runsDone} {f.runsDone === 1 ? "run" : "runs"} done
        </span>
        {f.landed != null && <span>{f.landed} landed</span>}
        {f.verifiedCloses != null && <span>{f.verifiedCloses} verified closes</span>}
        <span title={CEILING_TITLE}>{f.ceiling ? `ceiling ${f.ceiling}` : "no spend ceiling"}</span>
      </p>

      {live && drive.phase === "running" &&
        (inFlight ? (
          <p className="mt-3 inline-flex items-center gap-1.5 type-caption tabular-nums text-accent">
            <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
            cycle {inFlight.run.cycle}/{inFlight.run.maxCycles} · {inFlight.lanes.filter((l) => l.phase === "done").length}/
            {inFlight.lanes.length} lanes done
          </p>
        ) : (
          <p className="mt-3 type-caption text-slate-500">Between runs — preparing the next one…</p>
        ))}

      {drive.error && <p className="mt-2 type-caption text-danger">{drive.error}</p>}
      {error && <p className="mt-2 type-caption text-danger">{error}</p>}

      <CockpitRunnerRepos rows={runnerRepoRows(drive)} onResume={live ? onResumeRepo : undefined} busy={busy} />

      {/* The newest few runs, newest first — numbered across the whole runner (older ones folded
          into `runsBefore` keep their place in the count). */}
      {recent.length > 0 && (
        <ul data-testid="runner-runs" className={`mt-3 ${TILE_LEDGER}`}>
          {recent.map(({ record, index }) => (
            <DriveRunRow key={record.runId} record={record} index={index} runner />
          ))}
        </ul>
      )}

      {live && (
        <>
          <button
            type="button"
            onClick={onStop}
            disabled={busy || drive.stopRequested}
            title={runnerStopHint(drive)}
            className="focus-ring mt-4 w-full rounded-md border border-danger/60 px-3 py-2 type-label tracking-[0.18em] text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {drive.stopRequested ? STOPPING_RUNNER_LABEL : "Stop runner"}
          </button>
          {drive.stopRequested && <p className="mt-1.5 type-caption text-slate-500">{runnerStopHint(drive)}</p>}
        </>
      )}
    </div>
  );
}
