// A hand-built STANDING RUNNER status for the cockpit's runner tests — a continuous drive with two repos
// and the default $100 ceiling. Test-only. Clock times are built from LOCAL dates (`at`), so a test that
// expects "15:00" on screen holds in whatever timezone the suite runs in.

import type { RepoRunnerState } from "@/lib/local/runner-types";
import type { DriveStatus } from "./driveTypes";

/** 2026-09-18 at a local wall-clock time, as the ISO string the wire carries. */
export const at = (h: number, m = 0, day = 18): string => new Date(2026, 8, day, h, m).toISOString();

export const repoState = (over: Partial<RepoRunnerState> & { repo: string }): RepoRunnerState => ({
  baseBranch: "main",
  paused: null,
  pausedUntil: null,
  note: null,
  failureStreak: 0,
  dryStreak: 0,
  lastMergeInSha: null,
  lastLandedSha: null,
  aheadOfBase: null,
  ...over,
});

export const runnerDrive = (over: Partial<DriveStatus> = {}): DriveStatus => ({
  id: "drive_r",
  org: "acme",
  phase: "running",
  repos: ["acme/web", "acme/api"],
  maxRuns: 3,
  maxCycles: 3,
  concurrency: 2,
  runs: [],
  measurement: null,
  runsBefore: 0,
  resumedFrom: null,
  startedAt: at(9),
  endedAt: null,
  error: null,
  stopRequested: false,
  mode: "continuous",
  pausedReason: null,
  pausedUntil: null,
  spendCeilingMicros: 10_000_000_000,
  repoState: [repoState({ repo: "acme/web" }), repoState({ repo: "acme/api" })],
  lastBeatAt: at(12, 12),
  ...over,
});
