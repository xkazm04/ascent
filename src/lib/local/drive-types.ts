// The DRIVE's wire shapes and its rope, apart from the engine that pulls it.
//
// Same split as loop-runs-types.ts ⇄ loop-engine.ts, and for the same reason: the cockpit needs the
// status shape and the caps in the BROWSER, and `drive.ts` cannot be imported there — it reaches for
// the db layer, the loop engine and `selfHosted()` at module scope. Declaring a second "equivalent"
// client copy is how a field silently stops arriving, so there is exactly one declaration and
// `drive.ts` re-exports it for every server-side caller that already imports from there.

// `interrupted` is the phase a drive acquires WITHOUT anybody deciding it: the boot sweep finds a
// `running` row no live process is driving and reconciles it. It is terminal — a drive spends agent
// sessions inside real working copies, so re-arming one is a human decision, never a boot-time one.
//
// `paused` and `idle` (spark theater-upgrade, 2026-09-18) belong to a CONTINUOUS drive — the standing
// runner — and neither is terminal: `paused` = a runner-wide breaker fired (spend ceiling, session
// limit); `idle` = every repo is backing off after dry runs and nothing is due yet. A bounded drive
// never enters either.
export type DrivePhase = "running" | "paused" | "idle" | "green" | "dry" | "ceiling" | "stopped" | "interrupted" | "error";

import type { LoopDelivery } from "@/lib/local/delivery-options";
import type { DriveDials, DriveMode, RepoRunnerState, RunnerPauseReason } from "@/lib/local/runner-types";
// Pure (no db, no `process`), so this module stays importable in the browser.
import { spendCeilingUsdFrom } from "@/lib/local/runner-breakers";

export type { LoopDelivery };

export interface DriveMeasurement {
  debt: number;
  green: boolean;
  greenCount: number;
  inScope: number;
  /** Repos still short of green, worst debt first — the next run's targets. */
  remaining: string[];
  /** Repos with no scan at all: they are not green, and a run cannot start from nothing. */
  unscanned: string[];
  /**
   * Per repo, the dimensions the verdict was reached WITHOUT — D2/D3/D4 when the repo's latest
   * reading was local and had no GitHub-side platform fold to carry (src/lib/analyze/platform-carry.ts).
   * Optional: absent on a measurement taken before this existed, which is unknown rather than "none".
   */
  notMeasurable?: { repo: string; dims: string[] }[];
}

export interface DriveRunRecord {
  runId: string;
  repos: string[];
  debtBefore: number;
  debtAfter: number | null;
  startedAt: string;
  endedAt: string | null;
  /**
   * WHY THIS RUN WAS ARMED WITH A MODEL NOBODY PICKED — the evidence-led switch, with the prices it
   * compared and the `n` behind each (`driveModelBasis`).
   *
   * `null`/absent means no switch happened, which is the honest reading of every run before this
   * field and of every run whose evidence did not carry a decision. It is NOT "we do not know why":
   * `pickDriveModel` returns null in exactly that case and the run keeps the configured model.
   *
   * Carried in `runsJson` (JSON-in-TEXT) rather than a column, the same widening `reposJson` uses —
   * additive and readable back from every existing row.
   */
  modelBasis?: string | null;
  /** THE STANDING RUNNER's measure of a run (a continuous drive only; absent on a bounded one): rows
   *  the rescan adjudicated closed, and lanes delivered onto the runner branch. Null = not counted yet. */
  verifiedCloses?: number | null;
  landed?: number | null;
  /** One line when the run ended oddly — "interrupted by a restart". Absent on an ordinary run. */
  note?: string | null;
}

/** What a runner EVENT is about: a runner-wide breaker firing or lifting, one repo pausing or resuming,
 *  a restart re-attaching the runner, or the runner waiting for the org's one run slot. */
export type DriveEventKind = "paused" | "resumed" | "repo-paused" | "repo-resumed" | "restart-resumed" | "slot-wait";

/**
 * A RUNNER EVENT (spark theater-upgrade, 2026-09-18). Carried in the SAME `runsJson` ledger as the runs
 * — there is no column of its own, and one timeline is what the ledger wants anyway — marked by its
 * `event` field. `toDriveStatus` splits the two on read, so `DriveStatus.runs` stays runs for every
 * reader and a bounded drive (which writes no events) serializes exactly as it always did.
 */
export interface DriveEventRecord {
  event: DriveEventKind;
  at: string;
  repo: string | null;
  /** The breaker or pause reason (`RunnerPauseReason` / `RepoPauseReason`), when the event is one. */
  reason: string | null;
  /** When the pause lifts by itself; null = the operator lifts it, or not a pause. */
  until: string | null;
  note: string;
}

export interface DriveStatus {
  id: string;
  org: string;
  phase: DrivePhase;
  repos: string[];
  maxRuns: number;
  maxCycles: number;
  concurrency: number;
  runs: DriveRunRecord[];
  /** The latest measurement, so a status read never has to re-score the fleet. */
  measurement: DriveMeasurement | null;
  /** Runs already spent by the drives THIS one resumed. `maxRuns` bounds the whole chain. */
  runsBefore: number;
  /** The interrupted drive this one continues, or null for a fresh drive. */
  resumedFrom: string | null;
  /** The RESOLVED agent configuration every run this drive dispatches is armed with, so a multi-run
   *  drive is ONE experiment. Null = unknown (a row written before the columns existed). */
  model?: string | null;
  effort?: string | null;
  /** How every run this drive dispatches delivers its lane branches. Null = `branch`, which is what
   *  every drive before this column did. */
  delivery?: LoopDelivery | null;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  stopRequested: boolean;

  // ── THE STANDING RUNNER (spark theater-upgrade, 2026-09-18). Optional so every bounded drive, and
  // every status assembled before the fields existed, keeps type-checking and meaning what it meant.
  /** `bounded` (absent = bounded) or `continuous` — the runner. */
  mode?: DriveMode;
  pausedReason?: RunnerPauseReason | null;
  pausedUntil?: string | null;
  /** Daily ceiling in MICRO-CENTS; null = none. */
  spendCeilingMicros?: number | null;
  repoState?: RepoRunnerState[];
  /** The dials every run this drive dispatches is armed with. */
  dials?: DriveDials | null;
  lastBeatAt?: string | null;
  /** The runner's events, oldest first and bounded — absent when there are none (every bounded drive). */
  events?: DriveEventRecord[];
}

export interface DriveInput {
  org: string;
  /** Explicit scope; defaults to every watched AND paired repo in the org. */
  repos?: string[];
  maxRuns?: number;
  maxCycles?: number;
  concurrency?: number;
  actor?: string | null;
  /** Runs the chain has already spent — set only by a resume, never by the route's start path. */
  runsBefore?: number;
  resumedFrom?: string | null;
  /** The operator's agent pick, normalized by the route; resolved against the env by `startDrive`. */
  model?: string | null;
  effort?: string | null;
  /** The operator's delivery pick, normalized by the route. Inherited by every run in the chain. */
  delivery?: LoopDelivery | null;
  /** `continuous` arms the standing runner; omitted = `bounded`, byte-identical to every drive before. */
  mode?: DriveMode;
  /** The runner's daily ceiling in USD; null/0 = none. Ignored by a bounded drive. */
  spendCeilingUsd?: number | null;
  /** The run dials every dispatched run inherits. */
  dials?: DriveDials | null;
}

/** The rope. A drive is bounded by construction — this is the most it may pull. */
export const DRIVE_MAX_RUNS_CAP = 8;
export const DRIVE_DEFAULT_MAX_RUNS = 3;
/** How often the driver looks at a run it is waiting on. Runs take minutes; this is not a hot loop. */
export const DRIVE_POLL_MS = 5_000;

/** A drive is PULLING (something is armed to poll it) versus finished. A continuous drive is also live
 *  while `paused` or `idle` — it is waiting, not over. */
export const isDriveLive = (phase: DrivePhase | null | undefined): boolean =>
  phase === "running" || phase === "paused" || phase === "idle";

/**
 * Runs the CHAIN has spent: the ones this segment finished plus the ones it inherited. A run still in
 * flight is not counted — it has not been measured, and the drive's own policy only ever counts runs
 * whose result it has seen.
 */
export const driveRunsDone = (drive: Pick<DriveStatus, "runs" | "runsBefore">): number =>
  drive.runsBefore + drive.runs.filter((r) => r.endedAt != null).length;

/**
 * What a resume of `drive` would start, pure — so "does resuming continue the count" is a fact about
 * a function rather than about a database. Null when there is nothing to resume: only an
 * `interrupted` drive is resumable, and only while the chain still has rope.
 */
export function resumeParams(drive: DriveStatus): DriveInput | null {
  if (drive.phase !== "interrupted") return null;
  // A STANDING RUNNER has no rope to continue — it has no run cap — so resuming one that a restart
  // could not re-attach (the loop was switched off at boot) re-arms the SAME runner: scope, bounds,
  // ceiling and dials. Its per-repo state starts fresh; the runner branch itself is on disk and is
  // simply picked up again.
  if (drive.mode === "continuous") {
    return {
      org: drive.org,
      repos: [...drive.repos],
      maxCycles: drive.maxCycles,
      concurrency: drive.concurrency,
      resumedFrom: drive.id,
      model: drive.model ?? null,
      effort: drive.effort ?? null,
      mode: "continuous",
      // Micro-cents back to the operator's unit; null stays "no ceiling".
      spendCeilingUsd: spendCeilingUsdFrom(drive.spendCeilingMicros),
      dials: drive.dials ?? null,
    };
  }
  const runsBefore = driveRunsDone(drive);
  if (runsBefore >= drive.maxRuns) return null;
  return {
    org: drive.org,
    repos: [...drive.repos],
    maxRuns: drive.maxRuns,
    maxCycles: drive.maxCycles,
    concurrency: drive.concurrency,
    runsBefore,
    resumedFrom: drive.id,
    // A resume continues the same experiment: re-arming the chain under a different model would make
    // the drive's own before/after ledger a comparison of two setups.
    model: drive.model ?? null,
    effort: drive.effort ?? null,
    // Delivery travels with a resume for the same reason the model does — and more sharply: a chain
    // that started landing into the operator's checkout and silently stopped halfway would be a
    // change to what the loop does to their disk, made by a restart rather than by them.
    delivery: drive.delivery ?? null,
  };
}
