// The gate the loop and the drive SHARE. The one assertion that matters is the last one: any input
// that blocks a run must block a drive, because a drive is a sequence of runs with the same blast
// radius. A future change that widens one and not the other fails here.

import { describe, expect, it } from "vitest";
import { canDispatch, cockpitSetupState, type CockpitGateInput } from "./cockpitGate";

const ok: CockpitGateInput = { selfHosted: true, repoCount: 4, isOwner: true, enabled: true, pairedCount: 2 };

describe("cockpitSetupState", () => {
  it("clears when every condition the routes enforce is met", () => {
    expect(cockpitSetupState(ok)).toBeNull();
  });

  it.each<[string, Partial<CockpitGateInput>, string]>([
    ["managed cloud has no loop at all", { selfHosted: false }, "hosted"],
    ["nothing scanned yet", { repoCount: 0 }, "no-repos"],
    ["a member may read but not dispatch", { isOwner: false }, "not-owner"],
    ["ASCENT_AUTOPILOT is off", { enabled: false }, "autopilot-off"],
    ["no working copy to edit", { pairedCount: 0 }, "unpaired"],
  ])("names the single next action when %s", (_why, over, expected) => {
    expect(cockpitSetupState({ ...ok, ...over })).toBe(expected);
  });

  it("reports the OUTERMOST block first — self-hosting before anything it would gate", () => {
    expect(cockpitSetupState({ selfHosted: false, repoCount: 0, isOwner: false, enabled: false, pairedCount: 0 })).toBe("hosted");
  });
});

describe("canDispatch", () => {
  it("is exactly the negation of a setup state — one gate, two callers", () => {
    const cases: CockpitGateInput[] = [
      ok,
      { ...ok, selfHosted: false },
      { ...ok, repoCount: 0 },
      { ...ok, isOwner: false },
      { ...ok, enabled: false },
      { ...ok, pairedCount: 0 },
    ];
    for (const c of cases) expect(canDispatch(c)).toBe(cockpitSetupState(c) == null);
  });
});
