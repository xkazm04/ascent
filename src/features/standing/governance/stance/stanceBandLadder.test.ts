// Band readings onto ladder steps. A repo in a tier the stance does not declare is not measured.
import { describe, expect, it } from "vitest";
import { bandLadderState, stanceBandSteps, tightestMeasured, type BandReading } from "./stanceBandLadder";

const row = (tier: BandReading["tier"], declared: boolean, repos: number): BandReading => ({ tier, declared, repos });

describe("bandLadderState", () => {
  it("keeps an undeclared tier unmeasured even when repos sit in it", () => {
    expect(bandLadderState(false, 4, false)).toBe("unmeasured");
    expect(bandLadderState(false, 0, false)).toBe("unmeasured");
  });

  it("marks a declaration with no repo as open, and the frontier measured band as current", () => {
    expect(bandLadderState(true, 0, false)).toBe("open");
    expect(bandLadderState(true, 2, false)).toBe("reached");
    expect(bandLadderState(true, 2, true)).toBe("current");
  });
});

describe("stanceBandSteps", () => {
  it("puts current on the tightest occupied band and leaves the rest honest", () => {
    const rows = [row("T0", true, 2), row("T1", true, 1), row("T2", true, 0), row("T3", false, 3)];
    expect(tightestMeasured(rows)).toBe("T1");
    const steps = stanceBandSteps(rows);
    expect(steps.map((s) => s.state)).toEqual(["reached", "current", "open", "unmeasured"]);
    expect(steps[1]?.detail).toBe("1 repo");
    expect(steps[2]?.detail).toBe("Declared only");
    expect(steps[3]?.detail).toBe("Not judged");
    expect(steps.map((s) => `${s.label}${s.detail}`).join(" ")).not.toMatch(/\u2014/);
  });

  it("has no current step when nothing has been read", () => {
    const steps = stanceBandSteps([row("T0", false, 0), row("T2", true, 0)]);
    expect(steps.map((s) => s.state)).toEqual(["unmeasured", "unmeasured", "open", "unmeasured"]);
    expect(tightestMeasured([row("T2", true, 0)])).toBeNull();
  });
});
