import { describe, expect, it } from "vitest";
import { lanePulse, NOW, pulse } from "./deskFixture";
import { flightView, serverClock, stageIndex } from "./inFlightModel";

const now = Date.parse(NOW);

describe("flightView", () => {
  it("answers the four questions from one pulse", () => {
    const v = flightView(pulse(), now, false, 1_000);
    expect(v.running).toMatchObject({ headline: "Running", sub: "up 3 h", tone: "live" });
    expect(v.now.headline).toBe("kp · Checking the build");
    expect(v.now.sub).toBe("for 10 s");
    expect(v.today).toMatchObject({ verified: 10, landed: 5, spend: "$12.94", ceiling: "$100.00" });
    expect(v.needs).toMatchObject({ headline: "Nothing waiting", count: 0 });
    expect(v.runLabel).toBe("run #14 · cycle 2/3");
  });

  it("measures time used against the lane deadline, and draws no bar without one", () => {
    const [row] = flightView(pulse(), now, false, 0).lanes;
    expect(row).toMatchObject({ usedMs: 120_000, budgetMs: 240_000, frac: 0.5, stage: 3, file: "src/scoring/claims.ts", cost: "$0.62" });
    const [bare] = flightView(pulse({ lanes: [lanePulse({ deadlineAt: null, costMicros: null })] }), now, false, 0).lanes;
    expect(bare).toMatchObject({ budgetMs: null, frac: null, cost: null });
  });

  it("turns stale into the truth about the feed", () => {
    const v = flightView(pulse(), now, true, 13_000);
    expect(v.running).toMatchObject({ headline: "Reconnecting…", tone: "warn" });
    expect(v.now.headline).toBe("Last heard 13 s ago");
  });

  it("says who needs a person, and names a paused runner", () => {
    const p = pulse({ needsYou: { plans: 2, pausedRepos: 1, runnerPaused: false } });
    p.runner!.phase = "paused";
    p.runner!.pausedReason = "spend-ceiling";
    const v = flightView(p, now, false, 0);
    expect(v.running.headline).toBe("Paused — spend ceiling");
    expect(v.needs).toMatchObject({ headline: "2 plans wait · 1 repo paused · runner paused", count: 4 });
  });

  it("says No runner when there is none", () => {
    expect(flightView(pulse({ runner: null, run: null, lanes: [] }), now, false, 0).running.headline).toBe("No runner");
  });
});

describe("serverClock", () => {
  it("advances the server's instant by local time since receipt, and freezes it when stale", () => {
    const p = pulse();
    expect(serverClock(p, 1_000, 4_000, false)).toBe(now + 3_000);
    expect(serverClock(p, 1_000, 40_000, true)).toBe(now);
  });
});

describe("stageIndex", () => {
  it("places every phase on the six-step track", () => {
    expect(stageIndex("queued")).toBe(-1);
    expect(stageIndex("planning")).toBe(0);
    expect(stageIndex("agent-quiet")).toBe(2);
    expect(stageIndex("rescanning")).toBe(5);
    expect(stageIndex("done")).toBe(6);
  });
});
