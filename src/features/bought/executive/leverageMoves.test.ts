// The leverage bars' one rule, pinned without a DOM: a gap the engine could not project NEVER gets a
// bar, and the bar that IS drawn is reach × impact on one scale.
//
// The panel used to carry this in prose ("with the engine-true maturity each repo stands to gain if
// the gap closes") and then silently omitted the phrase when `projectedPoints` was null — a reader
// could not tell an omitted projection from a small one. `state: "missing"` is that distinction, and
// `rendersValue(missing)` is false, so the view cannot print a numeral beside it.

import { describe, expect, it } from "vitest";
import { rendersValue } from "@/components/org/viz";
import type { OrgRec } from "@/lib/db";
import { leverageBars, leverageMax, leverageReadout, leverageStates } from "./leverageMoves";

const rec = (over: Partial<OrgRec> = {}): OrgRec => ({
  title: "Add agent guidance",
  dimId: "D1",
  impact: "high",
  rationale: "",
  explore: [],
  repoCount: 3,
  repos: ["a", "b", "c"],
  leverage: 42,
  projectedPoints: 4,
  liftsRepos: 1,
  ...over,
});

describe("leverageBars", () => {
  it("scales a bar by fleet points — the per-repo gain times the repos that share the gap", () => {
    const [bar] = leverageBars([rec({ projectedPoints: 4, repoCount: 3 })]);
    expect(bar!.fleetPoints).toBe(12);
    expect(bar!.perRepo).toBe(4);
    expect(bar!.state).toBe("measured");
  });

  it("draws a void — never a zero-length bar — when the engine projected nothing", () => {
    const [bar] = leverageBars([rec({ projectedPoints: null })]);
    expect(bar!.fleetPoints).toBeNull();
    expect(bar!.state).toBe("missing");
    // The guard that stops the view printing a number where there is no measurement.
    expect(rendersValue(bar!.state)).toBe(false);
    expect(leverageReadout(bar!)).toBe("—");
  });

  it("treats a non-positive or non-finite projection as no projection, not as a gain", () => {
    const bars = leverageBars([rec({ projectedPoints: 0 }), rec({ projectedPoints: Number.NaN })]);
    expect(bars.map((b) => b.state)).toEqual(["missing", "missing"]);
  });

  it("never lets the level-crossing tick sit past the end of its own bar", () => {
    const [bar] = leverageBars([rec({ repoCount: 2, liftsRepos: 9 })]);
    expect(bar!.liftsRepos).toBe(2);
  });

  it("pre-formats reach so no function prop crosses into the view", () => {
    const [bar] = leverageBars([rec({ repoCount: 8, repos: ["a", "b", "c", "d", "e", "f", "g", "h"] })]);
    expect(bar!.reach).toBe("shared by 8 repos: a, b, c, d, e, f +2");
    expect(leverageBars([rec({ repoCount: 1, repos: ["a"] })])[0]!.reach).toBe("shared by 1 repo: a");
  });

  it("prints the per-repo gain and the reach in the readout, so the segments are legible as numbers too", () => {
    expect(leverageReadout(leverageBars([rec()])[0]!)).toBe("12 pts · +4 × 3");
  });
});

describe("leverageMax / leverageStates", () => {
  it("has no domain at all when nothing is projected, so every row draws a void", () => {
    const bars = leverageBars([rec({ projectedPoints: null }), rec({ projectedPoints: null })]);
    expect(leverageMax(bars)).toBe(0);
    expect(leverageStates(bars)).toEqual(["missing"]);
  });

  it("lists only the states present, in the kit's order", () => {
    const bars = leverageBars([rec(), rec({ projectedPoints: null })]);
    expect(leverageStates(bars)).toEqual(["measured", "missing"]);
    expect(leverageStates(leverageBars([rec()]))).toEqual(["measured"]);
  });

  it("takes the domain from the largest fleet total, not from the first row", () => {
    const bars = leverageBars([rec({ projectedPoints: 2, repoCount: 2 }), rec({ projectedPoints: 9, repoCount: 5 })]);
    expect(leverageMax(bars)).toBe(45);
  });
});
