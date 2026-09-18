"use client";

// THE TERMINAL BANNER. Extracted from CockpitDrivePanel (pure relocation, plus the runner's reading)
// so that file stays the live panel; CockpitDrivePanel re-exports it, so every import of
// `DriveVerdict` from there — OutcomeSection's included — keeps resolving unchanged.
//
// It sits ABOVE the single run's outcome ledger rather than replacing it: the ledger answers "what did
// the last run do", and this answers the different question "why did the drive stop", which is the
// one that decides what the operator does next.
//
// A STANDING RUNNER (2026-09-18) reads as a runner here too: "Runner · Stopped", its runs and what
// landed — never "n/N runs" or "green", which are a bounded drive's words (`driveVerdict`).

import { Kicker } from "@/components/ui";
import { driveProgress, driveVerdict, type DriveVerdictTone } from "./driveModel";
import type { DriveStatus } from "./driveTypes";
import { runnerFigures } from "./runnerModel";

const TONE_CLASS: Record<DriveVerdictTone, string> = {
  green: "border-accent/60 text-accent",
  warn: "border-warn/60 text-warn",
  muted: "border-divider text-slate-400",
  danger: "border-danger/60 text-danger",
};

function figuresLine(drive: DriveStatus): string {
  const p = driveProgress(drive);
  if (!p.continuous) return `${p.runsDone}/${p.maxRuns} runs · ${p.greenCount}/${p.inScope} green`;
  const f = runnerFigures(drive);
  return [`${f.runsDone} ${f.runsDone === 1 ? "run" : "runs"}`, f.landed != null ? `${f.landed} landed` : null].filter(Boolean).join(" · ");
}

export function DriveVerdict({ drive, onBack }: { drive: DriveStatus; onBack?: () => void }) {
  const v = driveVerdict(drive);
  const p = driveProgress(drive);
  return (
    <div className={`mb-3 rounded-md border px-3 py-2.5 ${TONE_CLASS[v.tone]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="accent">
          {p.continuous ? "Runner" : "Drive"} · {v.label}
        </Kicker>
        <span className="type-caption tabular-nums text-slate-500">{figuresLine(drive)}</span>
      </div>
      <p className="mt-1.5 type-body-sm leading-relaxed text-slate-400">{v.detail}</p>
      {/* A terminal verdict has to disclose what it could not see. "Green" over six dimensions is a
          real result and a different claim from "green" over nine. */}
      {p.notMeasurable && <p className="mt-1 type-caption text-slate-500">{p.notMeasurable}</p>}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="focus-ring mt-3 rounded-md border border-divider px-3 py-1.5 type-label tracking-[0.18em] text-slate-400 transition hover:border-accent hover:text-white"
        >
          Back to inspect
        </button>
      )}
    </div>
  );
}
