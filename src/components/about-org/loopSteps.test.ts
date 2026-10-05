// The /about-org loop is a VIEW of the declared journey (src/lib/org/orgJourney.ts), not a second
// declaration of it. These pin the derivation: it used to be a hand-typed five-verb list that named
// retired lanes, sent Decide and Apply to the same tab, and returned to Scan while the decided journey
// returns to Read.

import { describe, it, expect } from "vitest";
import { ORG_STAGES } from "@/lib/org/orgJourney";
import { ORG_NAV_GROUPS } from "@/lib/org/orgTabs";
import { LOOP_RETURN_INDEX, LOOP_STEPS } from "./loopSteps";

describe("the /about-org loop is the declared journey", () => {
  it("has one step per stage, in order, entering on each stage's entry tab", () => {
    expect(LOOP_STEPS.map((s) => s.tab)).toEqual(ORG_STAGES.map((s) => s.entryTab));
    expect(LOOP_STEPS.map((s) => s.title)).toEqual(ORG_STAGES.map((s) => s.label));
  });

  it("never sends two steps to the same tab", () => {
    expect(new Set(LOOP_STEPS.map((s) => s.tab)).size).toBe(LOOP_STEPS.length);
  });

  it("names only lanes the rail has, and the lane that holds the step's tab", () => {
    for (const s of LOOP_STEPS) {
      const lane = ORG_NAV_GROUPS.find((g) => g.items.some((i) => i.id === s.tab));
      expect(lane, s.tab).toBeDefined();
      expect(s.module, s.tab).toBe(lane!.label);
    }
  });

  it("returns to Read, the stage the decided journey wraps to", () => {
    expect(LOOP_STEPS[LOOP_RETURN_INDEX]!.title).toBe("Read");
    expect(ORG_STAGES[LOOP_RETURN_INDEX]!.id).toBe("read");
  });

  it("prints copy with no em dashes", () => {
    for (const s of LOOP_STEPS) expect(s.detail, s.tab).not.toContain("—");
  });
});
