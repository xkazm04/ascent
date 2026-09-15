// THE LANE WATCHDOG — the derivation of a cycle's ceiling, and the one property everything else
// rests on: a promise that NEVER SETTLES is still cut loose at the deadline.
//
// The never-settling case is the whole point and is written first. Every timeout in the loop before
// this one assumed the thing it was waiting on would eventually come back — a killed child, a
// provider call, a git invocation whose stdio a grandchild still holds. Two campaigns died proving
// otherwise, so the test uses the honest fixture: `new Promise(() => {})`.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LANE_GIT_ALLOWANCE_MS,
  LANE_RESCAN_ALLOWANCE_MS,
  agentTimeoutMs,
  createLaneWatchdog,
  isLaneDeadlineError,
  laneDeadlineMs,
} from "@/lib/local/lane-watchdog";

/** The fixture the loop had no answer for: a wait nothing will ever settle. */
const never = <T,>(): Promise<T> => new Promise<T>(() => {});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("a stage that never settles", () => {
  it("is cut at the deadline, with the stage that was in flight", async () => {
    const watch = createLaneWatchdog({ deadlineMs: 10 });
    const err = await watch.stage("rescan", never).catch((e: unknown) => e);
    expect(isLaneDeadlineError(err)).toBe(true);
    expect(watch.firedStage).toBe("rescan");
    expect(watch.firedReason).toBe("deadline");
    expect(String((err as Error).message)).toContain("rescanning the worktree");
    watch.dispose();
  });

  it("refuses every LATER stage too, so a cut lane cannot walk on", async () => {
    const watch = createLaneWatchdog({ deadlineMs: 10 });
    await watch.stage("verify", never).catch(() => null);
    const work = vi.fn(async () => "did it");
    // A swallowed rejection somewhere in the lane must not buy the cycle another stage: the
    // watchdog answers the next call from its own state rather than from another race.
    await expect(watch.stage("commit", work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
    // …and the recorded stage stays the one that was actually in flight when it fired.
    expect(watch.firedStage).toBe("verify");
    watch.dispose();
  });

  it("does not fire on a stage that finishes in time, and leaves nothing armed", async () => {
    vi.useFakeTimers();
    const watch = createLaneWatchdog({ deadlineMs: 60_000 });
    await expect(watch.stage("agent", async () => "ok")).resolves.toBe("ok");
    watch.dispose();
    // ONE timer per lane, armed lazily and cleared on the way out — a fast cycle leaves the loop's
    // timer table exactly as it found it.
    expect(vi.getTimerCount()).toBe(0);
    expect(watch.fired).toBe(false);
  });

  it("arms nothing at all until the first stage runs", () => {
    vi.useFakeTimers();
    const watch = createLaneWatchdog({ deadlineMs: 60_000 });
    expect(vi.getTimerCount()).toBe(0);
    watch.dispose();
  });
});

describe("abort — the teeth behind a stop", () => {
  it("cuts an in-flight stage immediately and says it was a stop, not a timeout", async () => {
    const watch = createLaneWatchdog({ deadlineMs: 60 * 60_000 });
    const running = watch.stage("agent", never).catch((e: unknown) => e);
    watch.abort();
    const err = await running;
    expect(isLaneDeadlineError(err)).toBe(true);
    expect(watch.firedReason).toBe("stopped");
    expect(watch.firedStage).toBe("agent");
    watch.dispose();
  });

  it("firing between stages is silent — no unhandled rejection, and the next stage throws", async () => {
    const watch = createLaneWatchdog({ deadlineMs: 60 * 60_000 });
    await watch.stage("git", async () => "sha");
    watch.abort(); // nobody is racing right now
    await new Promise((r) => setTimeout(r, 1));
    await expect(watch.stage("agent", async () => "ok")).rejects.toThrow();
    watch.dispose();
  });
});

describe("laneDeadlineMs — derived from the run's own parameters", () => {
  const defaults = { agentMs: 1_200_000, verifyMs: 600_000 };

  it("is the session cap + TWO verification runs + the rescan and git allowances", () => {
    expect(laneDeadlineMs(defaults)).toBe(1_200_000 + 2 * 600_000 + LANE_RESCAN_ALLOWANCE_MS + LANE_GIT_ALLOWANCE_MS);
    expect(laneDeadlineMs(defaults)).toBe(65 * 60_000); // the default run, stated as a number
  });

  it("MOVES WITH THE AGENT CAP — an operator who raises it raises the ceiling by the same amount", () => {
    const raised = laneDeadlineMs({ ...defaults, agentMs: 3_600_000 });
    expect(raised - laneDeadlineMs(defaults)).toBe(2_400_000); // exactly the 40 minutes added
  });

  it("moves with the verify budget at TWICE the rate, because the guard runs twice", () => {
    const raised = laneDeadlineMs({ ...defaults, verifyMs: 900_000 });
    expect(raised - laneDeadlineMs(defaults)).toBe(2 * 300_000);
  });

  it("charges nothing for a guard that is switched off", () => {
    expect(laneDeadlineMs({ ...defaults, verifyEnabled: false })).toBe(
      1_200_000 + LANE_RESCAN_ALLOWANCE_MS + LANE_GIT_ALLOWANCE_MS,
    );
  });
});

describe("agentTimeoutMs — unchanged behaviour, new home", () => {
  it("takes an in-band override", () => {
    expect(agentTimeoutMs(2_700_000)).toBe(2_700_000);
  });

  it("falls back to the deployment's env value when nothing was chosen", () => {
    vi.stubEnv("ASCENT_AUTOPILOT_TIMEOUT_MS", "1800000");
    expect(agentTimeoutMs(null)).toBe(1_800_000);
  });

  it("ignores an out-of-band override rather than clamping it", () => {
    vi.stubEnv("ASCENT_AUTOPILOT_TIMEOUT_MS", "");
    expect(agentTimeoutMs(24 * 60 * 60_000)).toBe(1_200_000);
  });
});
