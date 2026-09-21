// THE STANDING RUNNER'S POLICY, table-tested. Pure: no db, no clock of its own, no git — so "which
// repos run next, which back off, when the runner idles" is a fact about these functions.

import { describe, expect, it } from "vitest";
import {
  applyRunOutcome,
  dryBackoffMs,
  freshRepoState,
  isRepoRunnable,
  liftRepoPause,
  planRunnerStep,
  reconcileRepoState,
  summarizeRunLanes,
  wakeRepos,
  type RepoRunOutcome,
  type RunnerLaneView,
  type RunnerStepInput,
} from "./runner-policy";
import { DRY_BACKOFF_MS, REPO_FAILURE_STREAK, type RepoRunnerState } from "./runner-types";

const NOW = new Date("2026-09-18T10:00:00.000Z");
const later = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const repo = (name: string, over: Partial<RepoRunnerState> = {}): RepoRunnerState => ({ ...freshRepoState(name), ...over });
const step = (over: Partial<RunnerStepInput>): RunnerStepInput => ({
  stopRequested: false,
  pausedReason: null,
  pausedUntil: null,
  repos: ["o/a", "o/b"],
  repoState: [repo("o/a"), repo("o/b")],
  now: NOW,
  ...over,
});
const outcome = (over: Partial<RepoRunOutcome>): RepoRunOutcome => ({ lanes: 1, failed: 0, landed: 0, verifiedCloses: 0, lastError: null, ...over });

describe("planRunnerStep — what the runner does next", () => {
  it("runs every repo that may run", () => {
    expect(planRunnerStep(step({}))).toEqual({ action: "run", repos: ["o/a", "o/b"] });
  });

  it("a stop outranks everything, including a breaker", () => {
    expect(planRunnerStep(step({ stopRequested: true, pausedReason: "spend-ceiling", pausedUntil: later(1_000) }))).toEqual({ action: "stop" });
  });

  it("a runner-wide breaker in force pauses the whole runner", () => {
    expect(planRunnerStep(step({ pausedReason: "session-limit", pausedUntil: later(60_000) }))).toEqual({
      action: "pause",
      reason: "session-limit",
      until: later(60_000),
    });
  });

  it("a runner-wide breaker whose time has come no longer pauses", () => {
    expect(planRunnerStep(step({ pausedReason: "spend-ceiling", pausedUntil: later(-1) })).action).toBe("run");
  });

  it("excludes paused repos — timed and operator-held alike", () => {
    const repoState = [repo("o/a", { paused: "dry-backoff", pausedUntil: later(3_600_000) }), repo("o/b")];
    expect(planRunnerStep(step({ repoState }))).toEqual({ action: "run", repos: ["o/b"] });
    const held = [repo("o/a", { paused: "branch-conflict" }), repo("o/b")];
    expect(planRunnerStep(step({ repoState: held }))).toEqual({ action: "run", repos: ["o/b"] });
  });

  it("re-admits a repo whose backoff has elapsed", () => {
    const repoState = [repo("o/a", { paused: "dry-backoff", pausedUntil: later(-1) }), repo("o/b", { paused: "repo-failures" })];
    expect(planRunnerStep(step({ repoState }))).toEqual({ action: "run", repos: ["o/a"] });
  });

  it("all repos waiting → idle until the EARLIEST timed wake", () => {
    const repoState = [
      repo("o/a", { paused: "dry-backoff", pausedUntil: later(4 * 3_600_000) }),
      repo("o/b", { paused: "dry-backoff", pausedUntil: later(3_600_000) }),
    ];
    expect(planRunnerStep(step({ repoState }))).toEqual({ action: "idle", until: later(3_600_000) });
  });

  it("all repos held by the operator → idle with no wake time", () => {
    const repoState = [repo("o/a", { paused: "repo-failures" }), repo("o/b", { paused: "branch-conflict" })];
    expect(planRunnerStep(step({ repoState }))).toEqual({ action: "idle", until: null });
  });

  it("a repo with no state yet is fresh, and runs", () => {
    expect(planRunnerStep(step({ repoState: [] }))).toEqual({ action: "run", repos: ["o/a", "o/b"] });
  });
});

describe("the dry backoff ladder: 1 h → 4 h → 12 h, the last repeats", () => {
  it.each([
    [1, DRY_BACKOFF_MS[0]],
    [2, DRY_BACKOFF_MS[1]],
    [3, DRY_BACKOFF_MS[2]],
    [4, DRY_BACKOFF_MS[2]],
    [9, DRY_BACKOFF_MS[2]],
  ])("dry run #%i backs off %i ms", (n, ms) => expect(dryBackoffMs(n)).toBe(ms));

  it("walks the ladder over consecutive dry runs, then a verified close resets it", () => {
    const s = repo("o/a");
    for (const [i, wait] of [DRY_BACKOFF_MS[0], DRY_BACKOFF_MS[1], DRY_BACKOFF_MS[2], DRY_BACKOFF_MS[2]].entries()) {
      expect(applyRunOutcome(s, outcome({ landed: 1 }), NOW)).toBe("dry-backoff");
      expect(s.dryStreak).toBe(i + 1);
      expect(s.pausedUntil).toBe(later(wait!));
    }
    expect(applyRunOutcome(s, outcome({ landed: 1, verifiedCloses: 2 }), NOW)).toBeNull();
    expect(s).toMatchObject({ dryStreak: 0, paused: null, pausedUntil: null, note: null });
  });

  it("a repo that got no lane at all is dry too — progress is a verified close, nothing less", () => {
    const s = repo("o/a");
    expect(applyRunOutcome(s, undefined, NOW)).toBe("dry-backoff");
    expect(s.failureStreak).toBe(0);
  });
});

describe("the repo-failures breaker", () => {
  it(`pauses after ${REPO_FAILURE_STREAK} consecutive all-failed runs, and only the operator lifts it`, () => {
    const s = repo("o/a");
    for (let i = 1; i < REPO_FAILURE_STREAK; i += 1) {
      expect(applyRunOutcome(s, outcome({ failed: 1, lastError: "boom" }), NOW)).toBe("dry-backoff");
      expect(s.failureStreak).toBe(i);
    }
    expect(applyRunOutcome(s, outcome({ failed: 1, lastError: "boom" }), NOW)).toBe("repo-failures");
    expect(s).toMatchObject({ paused: "repo-failures", pausedUntil: null });
    expect(s.note).toContain("boom");
    expect(isRepoRunnable(s, new Date(NOW.getTime() + 365 * 86_400_000))).toBe(false);
    expect(liftRepoPause(s)).toBe(true);
    expect(s).toMatchObject({ paused: null, failureStreak: 0 });
    expect(liftRepoPause(s)).toBe(false);
  });

  it("a lane that LANDED resets the streak", () => {
    const s = repo("o/a", { failureStreak: REPO_FAILURE_STREAK - 1 });
    applyRunOutcome(s, outcome({ lanes: 2, failed: 1, landed: 1, verifiedCloses: 1 }), NOW);
    expect(s.failureStreak).toBe(0);
  });

  it("a run where only SOME lanes failed and nothing landed neither grows nor resets it", () => {
    const s = repo("o/a", { failureStreak: 1 });
    applyRunOutcome(s, outcome({ lanes: 2, failed: 1 }), NOW);
    expect(s.failureStreak).toBe(1);
  });
});

describe("folding lanes, waking repos, reconciling scope", () => {
  const lane = (over: Partial<RunnerLaneView>): RunnerLaneView => ({
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

  it("summarizes per repo: failed (error or rejected), landed, verified closes", () => {
    const out = summarizeRunLanes([
      lane({ closedIds: ["x", "y"], landedAt: "t" }),
      lane({ phase: "error", error: "agent died" }),
      lane({ repoFullName: "o/b", verifyVerdict: "rejected" }),
    ]);
    expect(out.get("o/a")).toEqual({ lanes: 2, failed: 1, landed: 1, verifiedCloses: 2, lastError: "agent died" });
    expect(out.get("o/b")).toMatchObject({ lanes: 1, failed: 1, lastError: "the degradation guard rejected the lane" });
  });

  it("wakes only elapsed TIMED pauses", () => {
    const states = [
      repo("o/a", { paused: "dry-backoff", pausedUntil: later(-1) }),
      repo("o/b", { paused: "dry-backoff", pausedUntil: later(1_000) }),
      repo("o/c", { paused: "branch-conflict" }),
    ];
    expect(wakeRepos(states, NOW)).toEqual(["o/a"]);
    expect(states.map((s) => s.paused)).toEqual([null, "dry-backoff", "branch-conflict"]);
  });

  it("keeps known state and adds fresh entries in scope order", () => {
    const out = reconcileRepoState(["o/b", "o/a"], [repo("o/a", { dryStreak: 2 }), repo("o/gone")]);
    expect(out.map((s) => [s.repo, s.dryStreak])).toEqual([["o/b", 0], ["o/a", 2]]);
  });
});
