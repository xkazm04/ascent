// PER-TRANSPORT TIMING — that a ceiling is computed from the arm that will actually run.
//
// Kept beside `lane-watchdog.test.ts` rather than inside it: that file pins the DERIVATION (raising
// one dial raises the deadline by exactly that much), which must keep reading as one argument.

import { afterEach, describe, expect, it, vi } from "vitest";
import { agentTimeoutMs, laneDeadlineMs, LANE_GIT_ALLOWANCE_MS, LANE_RESCAN_ALLOWANCE_MS } from "@/lib/local/lane-watchdog";
import { claudeHostedTiming, claudeLocalTiming } from "@/lib/local/transport/claude";
import { AGENT_TIMEOUT_DEFAULT_MS } from "@/lib/local/run-limits";

const VERIFY_MS = 600_000;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agentTimeoutMs — the Claude band is untouched", () => {
  it("still resolves the deployment default exactly as it did before transports existed", () => {
    vi.stubEnv("ASCENT_AUTOPILOT_TIMEOUT_MS", "");
    expect(agentTimeoutMs()).toBe(AGENT_TIMEOUT_DEFAULT_MS);
    expect(agentTimeoutMs(null)).toBe(claudeHostedTiming.agentMs);
    expect(agentTimeoutMs(undefined, { transport: "claude" })).toBe(AGENT_TIMEOUT_DEFAULT_MS);
  });

  it("still honours ASCENT_AUTOPILOT_TIMEOUT_MS inside its min/cap band, for the hosted arm", () => {
    vi.stubEnv("ASCENT_AUTOPILOT_TIMEOUT_MS", "2400000");
    expect(agentTimeoutMs()).toBe(2_400_000);
    vi.stubEnv("ASCENT_AUTOPILOT_TIMEOUT_MS", "1"); // below the floor
    expect(agentTimeoutMs()).toBe(60_000);
    vi.stubEnv("ASCENT_AUTOPILOT_TIMEOUT_MS", "99999999"); // above the cap
    expect(agentTimeoutMs()).toBe(5_400_000);
  });

  it("still lets a per-run override win, on either arm", () => {
    expect(agentTimeoutMs(3_600_000)).toBe(3_600_000);
    expect(agentTimeoutMs(3_600_000, { transport: "claude", local: true })).toBe(3_600_000);
  });

  it("gives a LOCAL arm its profile band and ignores the hosted deployment dial", () => {
    // The dial is a number the operator chose while watching a hosted session. Reusing it for an arm
    // that generates at 11.5 tokens/s would fail every local lane on a ceiling nobody picked for it.
    vi.stubEnv("ASCENT_AUTOPILOT_TIMEOUT_MS", "1200000");
    expect(agentTimeoutMs(null, { transport: "claude", local: true })).toBe(claudeLocalTiming.agentMs);
    expect(agentTimeoutMs(null, { transport: "claude", local: true })).toBeGreaterThan(agentTimeoutMs(null));
  });
});

describe("laneDeadlineMs — derived from the arm that will actually run", () => {
  const base = { verifyMs: VERIFY_MS, verifyEnabled: true };

  it("is unchanged when the caller resolves agentMs itself — every existing call site", () => {
    expect(laneDeadlineMs({ ...base, agentMs: 1_200_000 })).toBe(
      1_200_000 + 2 * VERIFY_MS + LANE_RESCAN_ALLOWANCE_MS + LANE_GIT_ALLOWANCE_MS,
    );
    expect(laneDeadlineMs({ ...base, agentMs: 1_200_000 })).toBe(65 * 60_000);
  });

  it("falls back to the CLAUDE band when no arm and no agentMs are given", () => {
    expect(laneDeadlineMs(base)).toBe(laneDeadlineMs({ ...base, agentMs: claudeHostedTiming.agentMs }));
    expect(laneDeadlineMs({ ...base, exec: { transport: "claude" } })).toBe(laneDeadlineMs(base));
  });

  it("DIFFERS between two profiles with different timing — the whole point", () => {
    const hosted = laneDeadlineMs({ ...base, exec: { transport: "claude" } });
    const local = laneDeadlineMs({ ...base, exec: { transport: "claude", local: true } });
    expect(local).toBeGreaterThan(hosted);
    // …and by exactly the difference between the two bands, so the derivation stays readable: nobody
    // has to discover a hidden multiplier to know why a local lane gets longer.
    expect(local - hosted).toBe(claudeLocalTiming.agentMs - claudeHostedTiming.agentMs);
  });

  it("pays for the PLANNING arm separately — a split arm is two bands, not one", () => {
    // "Claude plans, a local model executes": the plan's share comes from the planning transport and
    // the session's share from the executing one. Reading both off one arm would price the run wrong
    // in whichever direction the arms differ.
    const split = laneDeadlineMs({ ...base, exec: { transport: "claude", local: true }, planArm: { transport: "claude" } });
    const both = laneDeadlineMs({
      ...base,
      exec: { transport: "claude", local: true },
      planArm: { transport: "claude", local: true },
    });
    expect(split - laneDeadlineMs({ ...base, exec: { transport: "claude", local: true } })).toBe(claudeHostedTiming.planMs);
    expect(both - split).toBe(claudeLocalTiming.planMs - claudeHostedTiming.planMs);
  });

  it("still pays NOTHING for planning when the lane does not plan", () => {
    expect(laneDeadlineMs({ ...base, agentMs: 1_200_000, planArm: null })).toBe(laneDeadlineMs({ ...base, agentMs: 1_200_000 }));
  });

  it("lets an explicit planMs win over the planning arm's band, for a caller that resolved it", () => {
    const d = laneDeadlineMs({ ...base, agentMs: 1_200_000, planMs: 0, planArm: { transport: "claude", local: true } });
    expect(d).toBe(laneDeadlineMs({ ...base, agentMs: 1_200_000 }));
  });
});
