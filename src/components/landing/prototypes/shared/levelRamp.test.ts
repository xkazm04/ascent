// The levels chart draws ONE dashed reference line, and for a year it drew the wrong quantity on the
// wrong axis: `POSTURE_THRESHOLD` (50) labelled "AI-NATIVE", on a chart whose Y axis is the weighted
// 0–100 index. POSTURE_THRESHOLD is the cut on the ADOPTION and RIGOR axes — AI-Native means BOTH
// clear 50 — and 50 on the index is inside L3, so the section's "cross the dashed line and the org
// reads AI-Native" invited a reader to cross into the level they were already in.
//
// These pin the replacement: a line that is a real band floor, labelled with the level it is the floor
// of, both read from the model. A re-banding moves the line; it cannot leave the label behind.

import { describe, it, expect } from "vitest";
import { LEVELS, LEVEL_BY_ID, POSTURE_THRESHOLD } from "@/lib/maturity/model";
import { AGENT_BAND, RAMP_STOPS, bandMid } from "./levelRamp";

describe("the trajectory chart's dashed line is a real boundary on the axis it is drawn on", () => {
  it("sits exactly on a level's band floor, not between bands", () => {
    const floors = LEVELS.map((l) => l.band[0]);
    expect(floors).toContain(AGENT_BAND.floor);
  });

  it("is the L4 floor — the rung where agents enter the process", () => {
    expect(AGENT_BAND.floor).toBe(LEVEL_BY_ID.L4.band[0]);
    expect(AGENT_BAND.level.id).toBe("L4");
  });

  it("labels itself with the level it marks, so the line and its caption cannot drift apart", () => {
    expect(AGENT_BAND.label).toContain(LEVEL_BY_ID.L4.id);
    expect(AGENT_BAND.label.toUpperCase()).toContain(LEVEL_BY_ID.L4.name.toUpperCase());
  });

  it("is NOT the posture threshold — the regression this replaced", () => {
    // Not merely a different number: POSTURE_THRESHOLD is measured on two other axes entirely. If a
    // future re-banding ever made L4's floor 50 by coincidence, that is the moment to re-read the
    // comment in levelRamp.ts rather than to relax this.
    expect(AGENT_BAND.floor).not.toBe(POSTURE_THRESHOLD);
    // And the posture cut really does land inside a lower band, which is why it read as "nowhere".
    const containing = LEVELS.find((l) => POSTURE_THRESHOLD >= l.band[0] && POSTURE_THRESHOLD <= l.band[1]);
    expect(containing?.id).toBe("L3");
  });
});

describe("levelRamp derivations", () => {
  it("emits one gradient stop per level, spanning 0→1 in ladder order", () => {
    expect(RAMP_STOPS.map((s) => s.id)).toEqual(LEVELS.map((l) => l.id));
    expect(RAMP_STOPS[0]!.offset).toBe(0);
    expect(RAMP_STOPS[RAMP_STOPS.length - 1]!.offset).toBe(1);
  });

  it("puts every level's waypoint inside its own band", () => {
    for (const l of LEVELS) {
      const mid = bandMid(l.band);
      expect(mid, l.id).toBeGreaterThanOrEqual(l.band[0]);
      expect(mid, l.id).toBeLessThanOrEqual(l.band[1]);
    }
  });
});
