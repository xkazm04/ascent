import { describe, expect, it } from "vitest";
import { programLadderSteps } from "./programLadder";

describe("programLadderSteps", () => {
  it("marks rungs below the standing reached, the standing current, and the chosen rung as the target", () => {
    const steps = programLadderSteps(89, "L4");
    expect(steps.map((s) => s.state)).toEqual(["reached", "reached", "reached", "reached", "current"]);
    expect(steps.find((s) => s.key === "L4")?.detail).toBe("target");
    expect(steps.find((s) => s.key === "L5")?.state).toBe("current");
  });

  it("leaves every rung unmeasured when the fleet has no live score", () => {
    const steps = programLadderSteps(null, "L4");
    expect(steps.every((s) => s.state === "unmeasured")).toBe(true);
    expect(steps.find((s) => s.key === "L4")?.detail).toBe("target");
  });
});
