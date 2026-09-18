// THE STANDING RUNNER'S DRIVER — continuous mode, with every seam faked (runner.fixture.ts).
//
// The claims: it runs PAST a green measurement and PAST a dry run (backing off, never stopping); it
// WAITS on a busy run slot instead of failing; every run it arms carries the runner's posture and the
// operator's dials; and a stop ends it `stopped`.

import { describe, expect, it } from "vitest";
import { RUNNER_SLOT_POLL_MS, runContinuous } from "./runner";
import { DRY_BACKOFF_MS, RUNNER_BRANCH } from "./runner-types";
import { T0, harness, lane, runnerStatus } from "./runner.fixture";

describe("runContinuous — it does not stop on green, dry or a run count", () => {
  it("runs past a green fleet and past a dry run, backing off the dry repo and coming back", async () => {
    const st = runnerStatus();
    const h = harness({
      lanes: (n) => {
        if (n === 3) st.stopRequested = true;
        // Run 1 closes a row; run 2 closes nothing (dry); run 3 runs after the back-off.
        return n === 1 ? [lane({ closedIds: ["rec-1"], landedAt: "t" })] : [lane()];
      },
    });

    await runContinuous(st, "octocat", h.deps);

    expect(h.started).toHaveLength(3);
    // The measurement said green the whole time, and the runner kept going.
    expect(st.measurement?.green).toBe(true);
    // Run 3 waited out the 1 h dry back-off that run 2 earned.
    expect(h.started[2]!.at - h.started[1]!.at).toBeGreaterThanOrEqual(DRY_BACKOFF_MS[0]!);
    expect(h.phases).toContain("idle");
    expect(st.runs.map((r) => r.verifiedCloses)).toEqual([1, 0, 0]);
    expect(st.runs.every((r) => r.endedAt != null)).toBe(true);
    expect(st.events?.some((e) => e.event === "repo-paused" && e.reason === "dry-backoff")).toBe(true);
    expect(st.events?.some((e) => e.event === "repo-resumed" && e.repo === "o/a")).toBe(true);
    expect(st.phase).toBe("stopped");
    expect(st.endedAt).not.toBeNull();
  });

  it("keeps working the repo that progresses while the dry one backs off", async () => {
    const st = runnerStatus({ repos: ["o/a", "o/b"] });
    const h = harness({
      lanes: (n, input) => {
        if (n === 3) st.stopRequested = true;
        return input.repos.map((repo) => lane({ repoFullName: repo, closedIds: repo === "o/b" ? ["x"] : [] }));
      },
    });

    await runContinuous(st, null, h.deps);

    expect(h.started.map((s) => s.input.repos)).toEqual([["o/a", "o/b"], ["o/b"], ["o/b"]]);
    expect(st.repoState?.find((s) => s.repo === "o/a")).toMatchObject({ paused: "dry-backoff", dryStreak: 1 });
    expect(st.repoState?.find((s) => s.repo === "o/b")).toMatchObject({ paused: null, dryStreak: 0 });
  });

  it("arms every run with the runner's posture — the dials ride along, the guard cannot be dialled off", async () => {
    const st = runnerStatus({ dials: { batchSize: 8, agentTimeoutMs: 1_800_000, verifyMode: "off", rescanCadence: "run" } });
    const h = harness({
      lanes: () => {
        st.stopRequested = true;
        return [lane({ closedIds: ["x"] })];
      },
    });

    await runContinuous(st, "octocat", h.deps);

    expect(h.started[0]!.input).toMatchObject({
      org: "acme",
      repos: ["o/a"],
      driveId: "drive_r",
      delivery: "runner",
      planMode: "on",
      baseRef: RUNNER_BRANCH,
      verifyMode: "on",
      runnerLane: { autoKeepLessons: true, installDeps: true },
      batchSize: 8,
      agentTimeoutMs: 1_800_000,
      rescanCadence: "run",
      model: "sonnet",
      actor: "octocat",
    });
  });

  it("stamps a heartbeat on every iteration", async () => {
    const st = runnerStatus();
    const h = harness({ lanes: () => ((st.stopRequested = true), [lane({ closedIds: ["x"] })]) });
    await runContinuous(st, null, h.deps);
    expect(st.lastBeatAt).toBe(new Date(h.clock.t).toISOString());
  });
});

describe("runContinuous — one run slot", () => {
  it("WAITS while a manual run holds the slot, then starts — and says so once", async () => {
    const st = runnerStatus();
    const h = harness({
      startError: (attempt) => (attempt <= 2 ? "A loop run is already active for acme." : null),
      lanes: () => ((st.stopRequested = true), [lane({ closedIds: ["x"] })]),
    });

    await runContinuous(st, null, h.deps);

    expect(h.started).toHaveLength(1);
    expect(h.sleeps.filter((ms) => ms === RUNNER_SLOT_POLL_MS)).toHaveLength(2);
    expect(h.started[0]!.at).toBe(T0 + 2 * RUNNER_SLOT_POLL_MS);
    expect(st.events?.filter((e) => e.event === "slot-wait")).toHaveLength(1);
    expect(st.phase).toBe("stopped");
  });

  it("a stop while waiting for the slot ends it without starting anything", async () => {
    const st = runnerStatus();
    const h = harness({
      startError: () => "A loop run is already active for acme.",
      onSleep: () => (st.stopRequested = true),
      lanes: () => [],
    });
    await runContinuous(st, null, h.deps);
    expect(h.started).toHaveLength(0);
    expect(st.phase).toBe("stopped");
  });

  it("a refusal that names a repo pauses THAT repo; any other refusal ends the runner in error", async () => {
    const st = runnerStatus({ repos: ["o/a", "o/b"] });
    const h = harness({
      startError: (attempt) => (attempt === 1 ? "Pairing broken for o/a: folder moved" : null),
      lanes: () => ((st.stopRequested = true), [lane({ repoFullName: "o/b", closedIds: ["x"] })]),
    });
    await runContinuous(st, null, h.deps);
    expect(st.repoState?.find((s) => s.repo === "o/a")).toMatchObject({ paused: "repo-failures" });
    expect(h.started[0]!.input.repos).toEqual(["o/b"]);

    const st2 = runnerStatus();
    const h2 = harness({ startError: () => "The loop requires a database.", lanes: () => [] });
    await expect(runContinuous(st2, null, h2.deps)).rejects.toThrow("requires a database");
  });
});
