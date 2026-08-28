// The DRIVE's wire shapes and its rope, apart from the engine that pulls it.
//
// Same split as loop-runs-types.ts ⇄ loop-engine.ts, and for the same reason: the cockpit needs the
// status shape and the caps in the BROWSER, and `drive.ts` cannot be imported there — it reaches for
// the db layer, the loop engine and `selfHosted()` at module scope. Declaring a second "equivalent"
// client copy is how a field silently stops arriving, so there is exactly one declaration and
// `drive.ts` re-exports it for every server-side caller that already imports from there.

export type DrivePhase = "running" | "green" | "dry" | "ceiling" | "stopped" | "error";

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
}

/** The rope. A drive is bounded by construction — this is the most it may pull. */
export const DRIVE_MAX_RUNS_CAP = 8;
export const DRIVE_DEFAULT_MAX_RUNS = 3;
/** How often the driver looks at a run it is waiting on. Runs take minutes; this is not a hot loop. */
export const DRIVE_POLL_MS = 5_000;

/** A drive is PULLING (something is armed to poll it) versus finished. `running` is the only live phase. */
export const isDriveLive = (phase: DrivePhase | null | undefined): boolean => phase === "running";
