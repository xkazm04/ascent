// The producer side of the subject, pinned as arithmetic: the tail statistic decides; one bad window
// drops a rung and a catastrophic one skips to the floor; three consecutive good windows climb one
// rung; the dead band resets the counter (good-neutral-good-neutral never promotes); the deadline
// resolves an unsettled tier DOWN; the preference decides whether the probe is created at all.

import { describe, expect, it } from "vitest";
import { TIER_COST_MS, windowSamples } from "./fixtures";
import { DOWNGRADE_MS, initialProbe, percentile, probeReducer, SETTLE_MS, STABLE_WINDOWS, UPGRADE_MS, UPGRADE_RUN, type ProbeAction, type ProbeState } from "./probe";

const run = (s: ProbeState, ...actions: ProbeAction[]) => actions.reduce(probeReducer, s);
const armed = () => run(initialProbe("auto", false), { type: "fire", winner: "idle" });
const win = (kind: "good" | "neutral" | "bad" | "catastrophic"): ProbeAction => ({ type: "window", kind });

describe("adaptive-fidelity-tiers probe", () => {
  it("summarises a window by a high percentile, and the fixture's kinds land where the thresholds say", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])).toBe(9);
    for (const tier of ["full", "reduced", "floor"] as const) {
      expect(percentile(windowSamples("good", 1, tier))).toBeLessThan(UPGRADE_MS);
      const neutral = percentile(windowSamples("neutral", 1, tier));
      expect(neutral).toBeGreaterThanOrEqual(UPGRADE_MS);
      expect(neutral).toBeLessThan(DOWNGRADE_MS);
      expect(percentile(windowSamples("bad", 1, tier))).toBeGreaterThanOrEqual(DOWNGRADE_MS);
    }
    // The dead band is wider than the cost step between adjacent tiers, so the loop cannot close.
    expect(DOWNGRADE_MS - UPGRADE_MS).toBeGreaterThan(TIER_COST_MS.full - TIER_COST_MS.reduced);
  });

  it("starts unmeasured at the declared default, with both deferral handles armed", () => {
    const s = initialProbe("auto", false);
    expect(s).toMatchObject({ phase: "unmeasured", tier: "reduced", tierSource: "declared-default", deferral: { requested: true, wonBy: null } });
    expect(probeReducer(s, { type: "fire", winner: "timeout" })).toMatchObject({ phase: "sampling", deferral: { wonBy: "timeout" } });
  });

  it("climbs one rung after a run of good windows (an arrival), and falls on one bad window", () => {
    const up = run(armed(), ...Array.from({ length: UPGRADE_RUN }, () => win("good")));
    expect(up.tier).toBe("full");
    expect(up.tierSource).toBe("measured");
    expect(up.upgradeRun).toBe(0);
    const down = probeReducer(up, win("bad"));
    expect(down.tier).toBe("reduced");
    expect(down.upgradeRun).toBe(0);
  });

  it("a catastrophic window skips to the floor; an upgrade never skips", () => {
    const full = run(armed(), win("good"), win("good"), win("good"));
    expect(probeReducer(full, win("catastrophic")).tier).toBe("floor");
    const climbed = run(armed(), win("catastrophic"), win("good"), win("good"), win("good"));
    expect(climbed.tier).toBe("reduced");
  });

  it("the dead band resets the counter: good-neutral-good-neutral-good never promotes", () => {
    const s = run(armed(), win("good"), win("neutral"), win("good"), win("neutral"), win("good"));
    expect(s.tier).toBe("reduced");
    expect(s.upgradeRun).toBe(1);
    expect(s.windows[1].verdict).toBe("neutral");
  });

  it("a straddled window is discarded: it decides nothing and counts toward nothing", () => {
    const s = run(armed(), win("good"), win("good"), { type: "window", kind: "bad", straddled: true });
    expect(s.windows[0].verdict).toBe("discarded");
    expect(s.tier).toBe("reduced");
    expect(s.upgradeRun).toBe(2);
    expect(s.stableRun).toBe(2); // unchanged: the discarded window neither advances nor resets it
  });

  it("settles on stability and tears down; a re-arm is a fresh bounded budget", () => {
    let s = armed();
    for (let i = 0; i < STABLE_WINDOWS + 1; i++) s = probeReducer(s, win("neutral"));
    expect(s).toMatchObject({ phase: "settled", settledBy: "stability" });
    expect(probeReducer(s, win("good"))).toBe(s); // no window closes on a settled probe
    const re = probeReducer(s, { type: "rearm", reason: "foreground" });
    expect(re).toMatchObject({ phase: "sampling", elapsedMs: 0, stableRun: 0, rearms: 1 });
  });

  it("the deadline is unconditional and resolves a flapping device to the lower tier", () => {
    // Alternate bad/good-run so the tier keeps moving until the fixture clock passes SETTLE_MS.
    let s = armed();
    let guard = 0;
    while (s.phase === "sampling" && guard++ < 200) {
      s = probeReducer(s, win("good"));
      if (s.phase === "sampling" && s.tier === "full") s = probeReducer(s, win("bad"));
    }
    expect(s.phase).toBe("settled");
    expect(s.settledBy).toBe("deadline");
    expect(s.elapsedMs).toBeGreaterThanOrEqual(SETTLE_MS);
    expect(s.tier).toBe("reduced"); // the lower of the tiers it flapped between
  });

  it("an expressed preference means the probe is never created", () => {
    expect(initialProbe("auto", true)).toMatchObject({ phase: "short-circuited", tier: "floor", tierSource: "preference", deferral: { requested: false } });
    expect(initialProbe("full", false)).toMatchObject({ phase: "short-circuited", tier: "full" });
    const s = initialProbe("floor", false);
    expect(probeReducer(s, { type: "fire", winner: "idle" })).toBe(s);
    expect(probeReducer(s, win("bad"))).toBe(s);
  });
});
