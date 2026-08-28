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
export type DrivePhase = "running" | "green" | "dry" | "ceiling" | "stopped" | "interrupted" | "error";

export interface DriveMeasurement {
  debt: number;
  green: boolean;
  greenCount: number;
  inScope: number;
  /** Repos still short of green, worst debt first — the next run's targets. */
  remaining: string[];
  /** Repos with no scan at all: they are not green, and a run cannot start from nothing. */
  unscanned: string[];
}

export interface DriveRunRecord {
  runId: string;
  repos: string[];
  debtBefore: number;
  debtAfter: number | null;
  startedAt: string;
  endedAt: string | null;
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
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  stopRequested: boolean;
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
}

/** The rope. A drive is bounded by construction — this is the most it may pull. */
export const DRIVE_MAX_RUNS_CAP = 8;
export const DRIVE_DEFAULT_MAX_RUNS = 3;
/** How often the driver looks at a run it is waiting on. Runs take minutes; this is not a hot loop. */
export const DRIVE_POLL_MS = 5_000;

/** A drive is PULLING (something is armed to poll it) versus finished. `running` is the only live phase. */
export const isDriveLive = (phase: DrivePhase | null | undefined): boolean => phase === "running";

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
  };
}
