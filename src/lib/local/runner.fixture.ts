// A FAKE WORLD for the standing runner's driver (`runner.ts`): a fake clock that only moves when the
// runner sleeps, a scripted engine, and in-memory git outcomes. No agent, no repository, no database —
// and no real hour, which is the only way "backs off an hour, then runs again" can be a unit test.
// Test-only: imported by `runner.*.test.ts`, never by production code.

import type { StartLoopRunInput } from "@/lib/local/loop-engine";
import type { DriveStatus } from "@/lib/local/drive-types";
import type { MergeInResult } from "@/lib/local/runner-branch";
import type { RunnerLaneView } from "@/lib/local/runner-policy";
import type { RunnerDeps } from "@/lib/local/runner";

export const T0 = new Date(2026, 8, 18, 8, 0, 0, 0).getTime(); // 08:00 local

export function runnerStatus(over: Partial<DriveStatus> = {}): DriveStatus {
  return {
    id: "drive_r",
    org: "acme",
    phase: "running",
    repos: ["o/a"],
    maxRuns: 0,
    maxCycles: 2,
    concurrency: 2,
    runs: [],
    measurement: null,
    runsBefore: 0,
    resumedFrom: null,
    model: "sonnet",
    effort: null,
    delivery: "runner",
    startedAt: new Date(T0).toISOString(),
    endedAt: null,
    error: null,
    stopRequested: false,
    mode: "continuous",
    pausedReason: null,
    pausedUntil: null,
    spendCeilingMicros: null,
    repoState: [],
    dials: null,
    lastBeatAt: null,
    ...over,
  };
}

export const lane = (over: Partial<RunnerLaneView> = {}): RunnerLaneView => ({
  repoFullName: "o/a",
  phase: "done",
  error: null,
  log: [],
  closedIds: [],
  verifyVerdict: "verified",
  landedAt: null,
  commits: 1,
  ...over,
});

export interface Harness {
  deps: RunnerDeps;
  clock: { t: number };
  started: { at: number; input: StartLoopRunInput }[];
  sleeps: number[];
  phases: string[];
}

export interface HarnessScript {
  /** The lanes run N (1-based) produced; may set `st.stopRequested` to end the test. */
  lanes: (n: number, input: StartLoopRunInput) => RunnerLaneView[];
  /** Throw from the Nth start attempt (1-based) to simulate a refusal. */
  startError?: (attempt: number) => string | null;
  spend?: (t: number) => number | null;
  mergeIn?: (path: string) => MergeInResult;
  onSleep?: (t: number) => void;
}

export function harness(script: HarnessScript): Harness {
  const clock = { t: T0 };
  const started: Harness["started"] = [];
  const sleeps: number[] = [];
  const phases: string[] = [];
  const inputs = new Map<string, StartLoopRunInput>();
  let attempts = 0;
  const deps: RunnerDeps = {
    now: () => new Date(clock.t),
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length > 10_000) throw new Error("runaway runner: slept 10,000 times");
      clock.t += ms;
      script.onSleep?.(clock.t);
    },
    save: async (s) => {
      if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
    },
    measure: async () => ({ debt: 0, green: true, greenCount: 1, inScope: 1, remaining: [], unscanned: [] }),
    spendSince: async () => script.spend?.(clock.t) ?? 0,
    pairedPath: async (_org, repo) => `/paired/${repo}`,
    resolveBase: async () => "main",
    ensureBranch: async () => ({ ok: true, note: "exists" }),
    mergeIn: async (path) => script.mergeIn?.(path) ?? { ok: true, changed: false, sha: "base", note: "up to date" },
    aheadCount: async () => 1,
    runnerTip: async () => "tip",
    startRun: async (input) => {
      attempts += 1;
      const refusal = script.startError?.(attempts) ?? null;
      if (refusal) throw new Error(refusal);
      const id = `run-${started.length + 1}`;
      started.push({ at: clock.t, input });
      inputs.set(id, input);
      return { id };
    },
    runEnded: async () => true,
    stopRun: async () => true,
    listLanes: async (runId) => script.lanes(Number(runId.slice(4)), inputs.get(runId)!),
  };
  return { deps, clock, started, sleeps, phases };
}
