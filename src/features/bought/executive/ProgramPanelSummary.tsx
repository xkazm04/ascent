"use client";

// The READ view of the transition programme (W1c) — the named commitment as it stands, plus the four
// actions that can change it: re-target, pause/resume, mark achieved. Split out of ProgramPanel.tsx
// (200-line cap); the panel still owns all the state and the fetches, this only renders and calls back.

import { CADENCE_LABEL } from "./programPanelConstants";
import { ProgramBaseline } from "./ProgramBaseline";
import type { TransitionProgramRow } from "@/lib/db/org-program";

export function ProgramPanelSummary({
  program,
  now = null,
  busy,
  onEdit,
  onStatus,
}: {
  program: TransitionProgramRow;
  /** Today's fleet overall standing — the far end of the movement from the frozen origin. */
  now?: number | null;
  busy: boolean;
  onEdit: () => void;
  onStatus: (status: "active" | "paused" | "achieved") => void;
}) {
  const origin = program.baseline?.overall ?? null;
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="type-lede text-white">{program.name}</span>
        <span className="type-label tracking-widest text-slate-500">
          → {program.targetLevel} · {CADENCE_LABEL[program.cadence].toLowerCase()} review
          {program.targetDate ? ` · by ${program.targetDate.slice(0, 10)}` : " · open-ended"}
        </span>
      </div>
      {/* First sight is the axis: where the origin was frozen, where the fleet stands now, and the
          rung the programme is steering at. The sentence below it is reduced to the two facts the
          drawing cannot carry — the exact date and the denominator behind the origin. */}
      {origin !== null ? (
        <>
          <ProgramBaseline
            baseline={origin}
            baselineAt={program.baselineAt}
            now={now}
            targetLevel={program.targetLevel}
          />
          <p className="type-body-sm text-slate-400">
            Origin frozen {program.baselineAt.slice(0, 10)} across {program.baseline?.scannedCount ?? 0} scanned repos.
          </p>
        </>
      ) : (
        // The zero state, where the reader has no mark to look at and genuinely needs the argument.
        <p className="type-body-sm text-slate-400">
          Started {program.baselineAt.slice(0, 10)} with nothing scanned yet. No baseline was recorded, so movement is
          reported only once there is an origin to measure from — and the origin, once recorded, is never recomputed.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} disabled={busy} className="focus-ring rounded-md border border-divider px-3 py-1.5 type-body-sm text-slate-300 transition hover:text-white disabled:opacity-50">
          Re-target
        </button>
        {program.status === "active" ? (
          <button type="button" onClick={() => onStatus("paused")} disabled={busy} className="focus-ring rounded-md border border-divider px-3 py-1.5 type-body-sm text-slate-400 transition hover:text-white disabled:opacity-50">
            Pause
          </button>
        ) : (
          <button type="button" onClick={() => onStatus("active")} disabled={busy} className="focus-ring rounded-md border border-divider px-3 py-1.5 type-body-sm text-slate-400 transition hover:text-white disabled:opacity-50">
            Resume
          </button>
        )}
        {program.status !== "achieved" && (
          <button type="button" onClick={() => onStatus("achieved")} disabled={busy} className="focus-ring rounded-md border border-divider px-3 py-1.5 type-body-sm text-slate-400 transition hover:text-white disabled:opacity-50">
            Mark achieved
          </button>
        )}
      </div>
    </div>
  );
}
