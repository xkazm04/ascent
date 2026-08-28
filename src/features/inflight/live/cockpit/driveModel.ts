// What a DriveStatus MEANS on screen, as pure functions — the drive panel and the terminal banner are
// then straight renderings of these, and the arithmetic that decides "is it working?" is testable
// without a DOM.
//
// The one number worth being careful about is progress. A drive's target is green, which is a
// PREDICATE, not a percentage — so the honest progress bar is debt burned against the debt the drive
// started with, and it is `null` (not 0, not 100) until there are two measurements to compare. A
// drive that starts already-green has nothing to burn and reads as complete, which is also honest.

import type { DrivePhase, DriveStatus } from "./driveTypes";

export interface DriveProgressView {
  phase: DrivePhase;
  live: boolean;
  runsDone: number;
  maxRuns: number;
  /** The loop run the drive is currently waiting on — null between runs and after the last one. */
  currentRunId: string | null;
  /** Debt when the drive's FIRST run started; null before any run has been dispatched. */
  debtStart: number | null;
  debtNow: number | null;
  /** Points of debt burned since the drive began. Positive is progress. */
  debtDrop: number | null;
  /** 0..1 of the starting debt already burned; null until a first run has been measured. */
  burned: number | null;
  greenCount: number;
  inScope: number;
  /** Repos still short of green — the next run's targets, worst first. */
  remaining: string[];
  unscanned: string[];
}

export function driveProgress(drive: DriveStatus): DriveProgressView {
  const m = drive.measurement;
  const first = drive.runs[0] ?? null;
  const debtStart = first ? first.debtBefore : null;
  const debtNow = m ? m.debt : null;
  const debtDrop = debtStart != null && debtNow != null ? debtStart - debtNow : null;
  return {
    phase: drive.phase,
    live: drive.endedAt == null && drive.phase === "running",
    runsDone: drive.runs.filter((r) => r.endedAt != null).length,
    maxRuns: drive.maxRuns,
    currentRunId: drive.runs.find((r) => r.endedAt == null)?.runId ?? null,
    debtStart,
    debtNow,
    debtDrop,
    burned: debtStart != null && debtStart > 0 && debtDrop != null ? clamp01(debtDrop / debtStart) : debtStart === 0 ? 1 : null,
    greenCount: m?.greenCount ?? 0,
    inScope: m?.inScope ?? drive.repos.length,
    remaining: m?.remaining ?? [],
    unscanned: m?.unscanned ?? [],
  };
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export type DriveVerdictTone = "green" | "warn" | "muted" | "danger";

export interface DriveVerdictView {
  label: string;
  tone: DriveVerdictTone;
  /** One sentence naming why the drive stopped — the operator's next decision depends on which. */
  detail: string;
}

/**
 * The terminal reading. Deliberately says something different for each of the three honest stops:
 * `dry` and `ceiling` both leave debt on the table but call for opposite next moves — one says the
 * agent stalled, the other says the rope was short.
 */
export function driveVerdict(drive: DriveStatus): DriveVerdictView {
  const p = driveProgress(drive);
  const left = p.inScope - p.greenCount;
  switch (drive.phase) {
    case "green":
      return { label: "Green", tone: "green", detail: `Every repo in scope cleared the band in ${runWord(p.runsDone)}.` };
    case "dry":
      return {
        label: "Dry",
        tone: "warn",
        detail: `A whole run moved nothing, so the drive stopped rather than spend the rest of its rope proving it again. ${left} still short of green.`,
      };
    case "ceiling":
      return {
        label: "Ceiling",
        tone: "warn",
        detail: `The ${runWord(p.maxRuns)} you allowed ran out with ${left} still short of green. Raise the run budget and drive again.`,
      };
    case "stopped":
      return { label: "Stopped", tone: "muted", detail: `You stopped the drive after ${runWord(p.runsDone)}.` };
    case "error":
      return { label: "Failed", tone: "danger", detail: drive.error ?? "The drive failed." };
    default:
      return { label: "Driving", tone: "muted", detail: `Run ${p.runsDone + (p.currentRunId ? 1 : 0)} of ${p.maxRuns}, target green.` };
  }
}

const runWord = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;

/** The run whose outcome ledger the terminal view should show — the last one the drive actually ran. */
export function lastDriveRunId(drive: DriveStatus): string | null {
  return drive.runs.length > 0 ? drive.runs[drive.runs.length - 1]!.runId : null;
}
