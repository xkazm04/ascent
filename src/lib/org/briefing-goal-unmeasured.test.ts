// G19: a goal whose metric nothing has scored reaches the briefing with `current`/`pct` null. Every
// briefing renderer (Goals card, markdown, board PDF) reads briefingGoalStats / briefingGoalLine, so
// pinning those two pins all three: the absence is stated in words, never as "0/60" or "null%".

import { describe, expect, it } from "vitest";
import { briefingGoalLine, briefingGoalStats, type BriefingGoal } from "./briefing";
import { GOAL_PCT_LABEL } from "@/lib/db/plan";

const unmeasured: BriefingGoal = {
  label: "Security to 60",
  current: null,
  target: 60,
  pct: null,
  pctBasis: "unmeasured",
  pctLabel: GOAL_PCT_LABEL.unmeasured,
  pace: "tracking",
  etaDays: null,
  headline: null,
  confidence: null,
  basis: null,
  insufficiency: null,
};

describe("briefingGoalStats / briefingGoalLine for an unmeasured goal", () => {
  it("states the absence and the target, never a zero standing or a null percentage", () => {
    const stats = briefingGoalStats(unmeasured);
    expect(stats).toMatch(/not measured/i);
    expect(stats).toContain("60");
    expect(stats).not.toMatch(/\bnull\b|\b0\/60\b|%/);
    expect(stats).not.toContain("\u2014");
    expect(briefingGoalLine(unmeasured)).toBe(`Security to 60: ${stats}`);
  });

  it("guard: a measured goal still prints current/target", () => {
    const measured: BriefingGoal = { ...unmeasured, current: 42, pct: 70, pctBasis: "attainment", pctLabel: GOAL_PCT_LABEL.attainment };
    expect(briefingGoalStats(measured)).toMatch(/^42\/60 \(70% · /);
  });
});
