// The invariant the unit-economics ribbon exists to enforce, pinned where it is cheapest to pin.
//
// "Until a provider that reports cost is connected, the money columns are empty rather than
// estimated" used to be a sentence in the integrations copy that the Delivery tab was trusted to
// honour. It is now a shape: `unitEconomicsStages` marks the spend stage `missing` with a null value,
// which is what makes `FlowRibbon` draw a void and refuse to join the connectors through it. A
// regression here would silently restore a legible, proportional "we spent nothing" chain.

import { describe, expect, it } from "vitest";
import { dollars, flowHasVoid, unitEconomicsStages } from "./unitFlowStages";

const base = { sessions: 40, producedCode: 28, costCents: 12_345, mergedAiChanges: 9 };

describe("unitEconomicsStages", () => {
  it("draws the whole chain when a provider reported cost", () => {
    const stages = unitEconomicsStages(base);
    expect(stages.map((s) => s.id)).toEqual(["spend", "produced", "merged"]);
    expect(stages.every((s) => s.state === "measured")).toBe(true);
    expect(stages[0]!.value).toBe(123);
    expect(flowHasVoid(stages)).toBe(false);
  });

  it("makes the money stage a VOID — never a zero — when nothing reported cost", () => {
    const stages = unitEconomicsStages({ ...base, costCents: 0 });
    const spend = stages.find((s) => s.id === "spend")!;
    expect(spend.value).toBeNull();
    expect(spend.state).toBe("missing");
    expect(flowHasVoid(stages)).toBe(true);
    // The observed halves of the chain are untouched: sessions happened, they just were not priced.
    expect(stages.find((s) => s.id === "produced")!.value).toBe(28);
    expect(stages.find((s) => s.id === "merged")!.value).toBe(9);
  });

  it("keeps a genuine zero of OUTPUT distinct from an absent measurement of spend", () => {
    const stages = unitEconomicsStages({ ...base, producedCode: 0, mergedAiChanges: 0 });
    // Zero merged AI changes IS a measurement — the sessions were counted and none produced a merge.
    expect(stages.find((s) => s.id === "merged")!.value).toBe(0);
    expect(stages.find((s) => s.id === "merged")!.state).toBe("measured");
    expect(flowHasVoid(stages)).toBe(false);
  });

  it("names the currency in the label, since the ribbon appends units after the figure", () => {
    expect(unitEconomicsStages(base)[0]!.label).toMatch(/USD/);
    expect(unitEconomicsStages(base)[0]!.unit).toBeUndefined();
  });
});

describe("dollars", () => {
  it("rounds cents to whole dollars for a glanceable stage figure", () => {
    expect(dollars(12_345)).toBe(123);
    expect(dollars(0)).toBe(0);
  });
});
