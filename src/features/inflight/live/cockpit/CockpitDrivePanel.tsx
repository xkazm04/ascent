"use client";

// DRIVE mode — the right rail while a drive is pulling the fleet toward green. It answers, in the
// order an operator asks: how much rope is left, is debt actually falling, what is running right now,
// and what has each run cost so far. Then the one action that is legal mid-drive: stop.
//
// The panel never shows a percentage of "done". The target is a PREDICATE (every dimension in the L5
// band), so the honest bar is debt burned against the debt the drive started with — see driveModel.
// Before the first run has been measured there is nothing to draw and the bar is absent rather than
// empty at zero, which would read as "it has achieved nothing" when the truth is "not yet measured".
//
// DEBT INVERTS THE HOUSE DELTA CONVENTION, deliberately. Everywhere else a rising number is the good
// one, so `deltaHex`/`fmtDelta` agree on sign. Here the number is DEBT: falling is the win. The
// colour therefore takes the size of the DROP (lime when debt fell) while the text prints the signed
// change in the debt itself ("-40"), and `signedDelta` is used rather than `fmtDelta` so no ▲/▼ glyph
// contradicts the colour next to it.

import { deltaHex, Kicker, signedDelta } from "@/components/ui";
import { InlineEmpty, TILE_LEDGER } from "@/components/org/shared/ui";
import { driveProgress, driveVerdict, type DriveVerdictTone } from "./driveModel";
import type { DriveRunRecord, DriveStatus } from "./driveTypes";
import type { LoopRunDetail } from "./loopTypes";

export interface CockpitDrivePanelProps {
  drive: DriveStatus;
  /** The loop run the drive is waiting on, from useLoopRun's own poll — the per-lane detail. */
  runDetail: LoopRunDetail | null;
  onStop: () => void;
  busy?: boolean;
  error?: string | null;
}

export function CockpitDrivePanel({ drive, runDetail, onStop, busy = false, error = null }: CockpitDrivePanelProps) {
  const p = driveProgress(drive);
  const inFlight = p.currentRunId && runDetail?.run.id === p.currentRunId ? runDetail : null;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Drive · to green</Kicker>
        <span className="font-mono text-xs tabular-nums text-slate-500">
          run {Math.min(p.runsDone + (p.currentRunId ? 1 : 0), p.maxRuns)}/{p.maxRuns}
        </span>
      </div>

      <DebtLine debtStart={p.debtStart} debtNow={p.debtNow} debtDrop={p.debtDrop} burned={p.burned} />

      <p className="mt-2 font-mono text-xs tabular-nums text-slate-500">
        {p.greenCount}/{p.inScope} green
        {p.remaining.length > 0 && <span className="ml-2 text-slate-600">· {p.remaining.length} short</span>}
        {p.unscanned.length > 0 && <span className="ml-2 text-warn">· {p.unscanned.length} never scanned</span>}
      </p>

      {p.notMeasurable && (
        <p
          className="mt-1 font-mono text-xs text-slate-500"
          title="These dimensions are credited partly for tooling that is installed rather than committed (review, CI and coverage Apps; default-branch Actions health), which a local scan cannot observe and no earlier GitHub scan recorded. They are EXCLUDED from the green verdict rather than counted as failed — driving at a number the reading cannot produce is how a loop runs forever."
        >
          {p.notMeasurable}
        </p>
      )}

      {inFlight ? (
        <p className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs tabular-nums text-accent">
          <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
          cycle {inFlight.run.cycle}/{inFlight.run.maxCycles} · {inFlight.lanes.filter((l) => l.phase === "done").length}/
          {inFlight.lanes.length} lanes done
        </p>
      ) : p.live ? (
        <p className="mt-3 font-mono text-xs text-slate-500">Re-scoring the fleet before the next run…</p>
      ) : null}

      {drive.error && <p className="mt-2 font-mono text-xs text-danger">{drive.error}</p>}
      {error && <p className="mt-2 font-mono text-xs text-danger">{error}</p>}

      {drive.runs.length === 0 ? (
        <InlineEmpty>No run dispatched yet.</InlineEmpty>
      ) : (
        <ul className={`mt-3 ${TILE_LEDGER}`}>
          {drive.runs.map((r, i) => (
            <DriveRunRow key={r.runId} record={r} index={i} />
          ))}
        </ul>
      )}

      {p.live && (
        <button
          type="button"
          onClick={onStop}
          disabled={busy || drive.stopRequested}
          className="focus-ring mt-4 w-full rounded-md border border-danger/60 px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {drive.stopRequested ? "Stopping after this run…" : "Stop drive"}
        </button>
      )}
    </div>
  );
}

function DebtLine({
  debtStart,
  debtNow,
  debtDrop,
  burned,
}: {
  debtStart: number | null;
  debtNow: number | null;
  debtDrop: number | null;
  burned: number | null;
}) {
  if (debtNow == null) return <p className="mt-2 font-mono text-xs text-slate-500">Measuring the fleet…</p>;
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-2xl tabular-nums text-slate-200">{debtNow}</span>
        <Kicker tone="muted">points of debt</Kicker>
        {debtStart != null && debtDrop != null && (
          <span className="font-mono text-xs tabular-nums" style={{ color: deltaHex(debtDrop) }}>
            {signedDelta(-debtDrop)} from {debtStart}
          </span>
        )}
      </div>
      {burned != null && (
        <div aria-hidden className="mt-2 h-1 w-full overflow-hidden rounded-full bg-divider">
          <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.round(burned * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function DriveRunRow({ record, index }: { record: DriveRunRecord; index: number }) {
  const moved = record.debtAfter != null ? record.debtBefore - record.debtAfter : null;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-ink px-4 py-2.5">
      <span className="font-mono text-xs text-slate-400">
        run {index + 1} · {record.repos.length} {record.repos.length === 1 ? "repo" : "repos"}
      </span>
      <span className="font-mono text-xs tabular-nums">
        {moved == null ? (
          <span className="text-slate-600">in flight</span>
        ) : (
          <>
            <span className="text-slate-500">
              {record.debtBefore} → {record.debtAfter}
            </span>
            <span className="ml-2" style={{ color: deltaHex(moved) }}>
              {signedDelta(-moved)}
            </span>
          </>
        )}
      </span>
    </li>
  );
}

const TONE_CLASS: Record<DriveVerdictTone, string> = {
  green: "border-accent/60 text-accent",
  warn: "border-warn/60 text-warn",
  muted: "border-divider text-slate-400",
  danger: "border-danger/60 text-danger",
};

/**
 * The terminal banner. It sits ABOVE the single run's outcome ledger rather than replacing it: the
 * ledger answers "what did the last run do", and this answers the different question "why did the
 * drive stop", which is the one that decides what the operator does next.
 */
export function DriveVerdict({ drive, onBack }: { drive: DriveStatus; onBack?: () => void }) {
  const v = driveVerdict(drive);
  const p = driveProgress(drive);
  return (
    <div className={`mb-3 rounded-md border px-3 py-2.5 ${TONE_CLASS[v.tone]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">Drive · {v.label}</Kicker>
        <span className="font-mono text-xs tabular-nums text-slate-500">
          {p.runsDone}/{p.maxRuns} runs · {p.greenCount}/{p.inScope} green
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{v.detail}</p>
      {/* A terminal verdict has to disclose what it could not see. "Green" over six dimensions is a
          real result and a different claim from "green" over nine. */}
      {p.notMeasurable && <p className="mt-1 font-mono text-xs text-slate-500">{p.notMeasurable}</p>}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="focus-ring mt-3 rounded-md border border-divider px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-slate-400 transition hover:border-accent hover:text-white"
        >
          Back to inspect
        </button>
      )}
    </div>
  );
}
