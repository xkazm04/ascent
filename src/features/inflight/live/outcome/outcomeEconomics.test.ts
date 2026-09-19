// THE SHEET'S REMEDIATION ECONOMICS (UAT `PRIYA-L1-704`). Three properties, and each is a rule a
// reader would otherwise have to take on trust:
//   • a rate is printed only when the WHOLE cell is priced and measured — an A/B cell missing one
//     lane's cost would otherwise divide a partial numerator and be confidently wrong;
//   • spend that bought ZERO points is stated as spend beside a zero, never as "not measured" and
//     never averaged away — the $10.19-for-0-points case the finding was filed over;
//   • no reported cost is said in words, because a blank cell reads as free.

import { describe, expect, it } from "vitest";
import { cellEconomics, economicsLabel, fmtCostMicros } from "./outcomeEconomics";
import type { LaneEconomics } from "../cockpit/loopTypes";

const lane = (over: Partial<LaneEconomics> = {}): LaneEconomics => ({
  laneId: "lane-1",
  repo: "acme/api",
  model: "sonnet",
  costMicros: 3_000_000,
  verifiedPoints: 2,
  microsPerVerifiedPoint: 1_500_000,
  byDim: [],
  unproductive: false,
  ...over,
});

describe("cellEconomics — the fold", () => {
  it("returns null for a cell with no lane economics, so an older payload renders nothing", () => {
    expect(cellEconomics([])).toBeNull();
  });

  it("divides a fully priced, fully measured cell", () => {
    const e = cellEconomics([lane()])!;
    expect(e.costMicros).toBe(3_000_000);
    expect(e.verifiedPoints).toBe(2);
    expect(e.microsPerVerifiedPoint).toBe(1_500_000);
    expect(e.unproductive).toBe(false);
  });

  it("sums an A/B cell's two lanes and divides once", () => {
    const e = cellEconomics([lane({ laneId: "a", costMicros: 3_000_000, verifiedPoints: 2 }), lane({ laneId: "b", costMicros: 1_000_000, verifiedPoints: 2 })])!;
    expect(e.lanes).toBe(2);
    expect(e.costMicros).toBe(4_000_000);
    expect(e.microsPerVerifiedPoint).toBe(1_000_000);
  });

  // The cost is still shown — it was really spent — but the RATE is withheld: dividing a numerator
  // that omits a lane's spend produces a number that is wrong in a direction nobody can see.
  it("withholds the rate when one lane in the cell reported no cost", () => {
    const e = cellEconomics([lane(), lane({ laneId: "b", costMicros: null })])!;
    expect(e.costMicros).toBe(3_000_000);
    expect(e.unpricedLanes).toBe(1);
    expect(e.microsPerVerifiedPoint).toBeNull();
  });

  it("withholds the rate when one lane had no measurable scan pair", () => {
    const e = cellEconomics([lane(), lane({ laneId: "b", verifiedPoints: null })])!;
    expect(e.unmeasuredLanes).toBe(1);
    expect(e.microsPerVerifiedPoint).toBeNull();
  });

  // Zero points is a MEASUREMENT, not a missing one, and dividing by it is not an expensive point.
  it("marks a measured cell that spent and moved nothing as unproductive, with no rate", () => {
    const e = cellEconomics([lane({ costMicros: 1_019_000_000, verifiedPoints: 0 })])!;
    expect(e.unproductive).toBe(true);
    expect(e.microsPerVerifiedPoint).toBeNull();
  });

  it("never calls an unpriced lane unproductive — nobody knows what it spent", () => {
    const e = cellEconomics([lane({ costMicros: null, verifiedPoints: 0 })])!;
    expect(e.unproductive).toBe(false);
    expect(e.costMicros).toBeNull();
  });
});

describe("economicsLabel — what the cell may honestly say", () => {
  it("renders nothing when there is nothing to say", () => {
    expect(economicsLabel(null)).toBeNull();
  });

  it("prints the rate when the cell is complete", () => {
    expect(economicsLabel(cellEconomics([lane()]))!.text).toBe("1.50¢/pt");
  });

  // The finding's own instance: $10.19 of spend for 0 verified points, which the org-wide average hid.
  it("prints spend beside a ZERO rather than calling it unmeasured, and warns", () => {
    const label = economicsLabel(cellEconomics([lane({ costMicros: 1_019_000_000, verifiedPoints: 0 })]))!;
    expect(label.text).toBe("$10.19 · 0 pts");
    expect(label.warn).toBe(true);
    expect(label.title).toMatch(/bought no verified maturity point/);
  });

  it("shows a known spend it cannot divide, and names the missing half", () => {
    const label = economicsLabel(cellEconomics([lane(), lane({ laneId: "b", costMicros: null })]))!;
    expect(label.text).toBe("3.00¢ · not measured");
    expect(label.title).toMatch(/1 lane reported no cost/);
    expect(label.warn).toBe(false);
  });

  it("says an unreported cost in words — a blank would read as free", () => {
    const label = economicsLabel(cellEconomics([lane({ costMicros: null, verifiedPoints: null })]))!;
    expect(label.text).toBe("cost not reported");
    expect(label.title).toMatch(/nothing here is free/);
  });
});

describe("fmtCostMicros — the ledger's own thresholds", () => {
  it("uses cents below a dollar and dollars above it", () => {
    expect(fmtCostMicros(4_230_000)).toBe("4.23¢");
    expect(fmtCostMicros(1_019_000_000)).toBe("$10.19");
  });
});
