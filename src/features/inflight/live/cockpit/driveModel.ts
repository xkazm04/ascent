// What a DriveStatus MEANS on screen, as pure functions — the drive panel and the terminal banner are
// then straight renderings of these, and the arithmetic that decides "is it working?" is testable
// without a DOM.
//
// The one number worth being careful about is progress. A drive's target is green, which is a
// PREDICATE, not a percentage — so the honest progress bar is debt burned against the debt the drive
// started with, and it is `null` (not 0, not 100) until there are two measurements to compare. A
// drive that starts already-green has nothing to burn and reads as complete, which is also honest.

import { driveRunsDone, resumeParams } from "./driveTypes";
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
  /**
   * The one line naming what the verdict was reached WITHOUT: dimensions no reading in scope could
   * measure (D2/D3/D4 on a local scan with no GitHub-side fold to carry). Null when everything was
   * measured. Without it a green light over six dimensions is indistinguishable from one over nine,
   * which is the same silence the fold's ceiling used to hide behind.
   */
  notMeasurable: string | null;
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
    // The CHAIN's count, so a resumed drive reads "run 3/3", not "run 1/3" — the rope the operator
    // gave is spent across the whole chain and the panel must not suggest otherwise.
    runsDone: driveRunsDone(drive),
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
    notMeasurable: notMeasurableLine(m?.notMeasurable),
  };
}

/** `D2/D3/D4 not measurable on 2 repos` — the dims named once, the repos counted. Naming every repo
 *  would push the panel into a list nobody reads; naming no dimension would say nothing at all. */
function notMeasurableLine(entries: { repo: string; dims: string[] }[] | undefined): string | null {
  if (!entries?.length) return null;
  const dims = [...new Set(entries.flatMap((e) => e.dims))].sort();
  if (dims.length === 0) return null;
  const n = entries.length;
  return `${dims.join("/")} not measurable on ${n} ${n === 1 ? "repo" : "repos"}`;
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
    case "interrupted":
      // Nobody decided this one — the boot sweep found a `running` row no process was pulling. Say
      // what survived (the runs are durable, their commits and rescans are real) and what did not.
      return {
        label: "Interrupted",
        tone: "warn",
        detail: `The server restarted mid-drive after ${runWord(p.runsDone)}. Those runs and their commits stand; the drive itself stopped and was not resumed on its own.`,
      };
    case "error":
      return { label: "Failed", tone: "danger", detail: drive.error ?? "The drive failed." };
    default:
      return { label: "Driving", tone: "muted", detail: `Run ${p.runsDone + (p.currentRunId ? 1 : 0)} of ${p.maxRuns}, target green.` };
  }
}

const runWord = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;

/**
 * What the "Resume drive" affordance needs, or null when there is nothing to offer. Derived from the
 * SERVER's own `resumeParams`, so the button appears exactly when the route would accept the request —
 * a drive that stopped for a reason a human chose (green/dry/ceiling/stopped) is not resumable, and
 * neither is an interrupted one whose chain already spent the whole budget.
 */
export function driveResume(drive: DriveStatus): { runsDone: number; runsLeft: number; repos: number } | null {
  const params = resumeParams(drive);
  if (!params) return null;
  const runsDone = params.runsBefore ?? 0;
  return { runsDone, runsLeft: drive.maxRuns - runsDone, repos: drive.repos.length };
}

/** The run whose outcome ledger the terminal view should show — the last one the drive actually ran. */
export function lastDriveRunId(drive: DriveStatus): string | null {
  return drive.runs.length > 0 ? drive.runs[drive.runs.length - 1]!.runId : null;
}
