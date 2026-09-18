// THE STANDING RUNNER PAUSES — it never proceeds on a breaker. Driven with the fake world in
// runner.fixture.ts: each runner-wide breaker pauses, holds until its `pausedUntil`, then resumes on
// its own; a stop during a pause ends the runner without waiting the pause out; a per-repo breaker
// pauses only its repo.

import { describe, expect, it } from "vitest";
import { runContinuous } from "./runner";
import { nextLocalMidnight } from "./runner-breakers";
import { REPO_FAILURE_STREAK } from "./runner-types";
import { T0, harness, lane, runnerStatus } from "./runner.fixture";

describe("runner-wide breakers pause, then resume after pausedUntil", () => {
  it("spend-ceiling: pauses until local midnight, then runs", async () => {
    const midnight = nextLocalMidnight(new Date(T0)).getTime();
    const st = runnerStatus({ spendCeilingMicros: 1_000 });
    const h = harness({
      spend: (t) => (t < midnight ? 5_000 : 0),
      lanes: () => ((st.stopRequested = true), [lane({ closedIds: ["x"] })]),
    });

    await runContinuous(st, null, h.deps);

    const paused = st.events?.find((e) => e.event === "paused");
    expect(paused).toMatchObject({ reason: "spend-ceiling", until: new Date(midnight).toISOString() });
    expect(h.phases.slice(0, 3)).toEqual(["running", "paused", "running"]);
    expect(h.started).toHaveLength(1);
    expect(h.started[0]!.at).toBeGreaterThanOrEqual(midnight);
    expect(st.events?.some((e) => e.event === "resumed" && e.reason === "spend-ceiling")).toBe(true);
    expect(st.pausedReason).toBeNull();
    expect(st.phase).toBe("stopped");
  });

  it("session-limit: a lane's agent hit the limit → the whole runner pauses until the named reset", async () => {
    const reset = T0 + 2 * 3_600_000;
    const st = runnerStatus({ repos: ["o/a", "o/b"] });
    const h = harness({
      lanes: (n, input) => {
        if (n === 2) {
          st.stopRequested = true;
          return input.repos.map((repo) => lane({ repoFullName: repo, closedIds: ["x"] }));
        }
        return [
          lane({ repoFullName: "o/a", phase: "error", log: [`Agent failed: Claude AI usage limit reached|${Math.floor(reset / 1000)}`] }),
          lane({ repoFullName: "o/b", closedIds: ["x"] }),
        ];
      },
    });

    await runContinuous(st, null, h.deps);

    expect(st.events?.find((e) => e.event === "paused")).toMatchObject({ reason: "session-limit", until: new Date(reset).toISOString() });
    expect(h.phases).toContain("paused");
    expect(h.started).toHaveLength(2);
    // Nothing ran until the reset — not even o/b, whose lane had succeeded: they share the quota.
    expect(h.started[1]!.at).toBeGreaterThanOrEqual(reset);
    expect(h.started[1]!.input.repos).toEqual(["o/a", "o/b"]);
    // The account cut the run short, not the repo: no failure streak, no dry back-off for o/a.
    expect(st.repoState?.find((s) => s.repo === "o/a")).toMatchObject({ failureStreak: 0, dryStreak: 0, paused: null });
    expect(st.phase).toBe("stopped");
  });

  it("a stop during a pause ends the runner `stopped` without waiting the pause out", async () => {
    const midnight = nextLocalMidnight(new Date(T0)).getTime();
    const st = runnerStatus({ spendCeilingMicros: 1_000 });
    const h = harness({ spend: () => 5_000, onSleep: () => (st.stopRequested = true), lanes: () => [] });

    await runContinuous(st, null, h.deps);

    expect(h.started).toHaveLength(0);
    expect(st.phase).toBe("stopped");
    expect(h.clock.t).toBeLessThan(midnight);
  });
});

describe("per-repo breakers pause only their repo", () => {
  it("branch-conflict: the merge-in conflicted → that repo pauses with the files named; the others run", async () => {
    const st = runnerStatus({ repos: ["o/a", "o/b"] });
    const h = harness({
      mergeIn: (path) =>
        path.endsWith("o/a")
          ? { ok: false, conflict: true, files: ["src/x.ts"], note: "Merging main into ascent/runner conflicts in 1 file(s): src/x.ts." }
          : { ok: true, changed: true, sha: "m", note: "merged" },
      lanes: () => ((st.stopRequested = true), [lane({ repoFullName: "o/b", closedIds: ["x"] })]),
    });

    await runContinuous(st, null, h.deps);

    expect(h.started[0]!.input.repos).toEqual(["o/b"]);
    const a = st.repoState?.find((s) => s.repo === "o/a");
    expect(a).toMatchObject({ paused: "branch-conflict", pausedUntil: null, baseBranch: "main" });
    expect(a?.note).toContain("src/x.ts");
    expect(st.repoState?.find((s) => s.repo === "o/b")).toMatchObject({ lastMergeInSha: "m", aheadOfBase: 1 });
  });

  it(`repo-failures: ${REPO_FAILURE_STREAK} all-failed runs pause the repo until the operator lifts it; all held → idle`, async () => {
    const st = runnerStatus();
    let idleSleeps = 0;
    const h = harness({
      lanes: () => [lane({ phase: "error", error: "Agent failed: boom" })],
      onSleep: () => {
        const s = st.repoState?.[0];
        if (s?.paused === "repo-failures" && ++idleSleeps >= 3) st.stopRequested = true;
      },
    });

    await runContinuous(st, null, h.deps);

    // Dry back-offs between the failed runs, then the operator-only pause.
    expect(h.started).toHaveLength(REPO_FAILURE_STREAK);
    expect(st.repoState?.[0]).toMatchObject({ paused: "repo-failures", pausedUntil: null, failureStreak: REPO_FAILURE_STREAK });
    expect(h.phases[h.phases.length - 2]).toBe("idle");
    expect(st.phase).toBe("stopped");
  });
});
