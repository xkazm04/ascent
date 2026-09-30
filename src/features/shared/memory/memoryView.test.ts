import { describe, expect, it } from "vitest";
import {
  bandCounts,
  coverageBands,
  factorState,
  ineligibleCell,
  reflectLadder,
  staleWindow,
  trustLadder,
} from "./memoryView";

describe("memoryView", () => {
  it("treats a non-finite trust score as not measured", () => {
    expect(trustLadder(Number.NaN).every((s) => s.state === "unmeasured")).toBe(true);
  });

  it("sits a high score on the high step and does not paint it as a risk", () => {
    const steps = trustLadder(1);
    expect(steps.map((s) => s.state)).toEqual(["reached", "reached", "current"]);
  });

  it("counts an empty trust band as open, not unmeasured", () => {
    const steps = bandCounts([{ confidence: 1 }, { confidence: 1 }]);
    expect(steps.find((s) => s.key === "low")?.state).toBe("open");
    expect(steps.find((s) => s.key === "high")?.state).toBe("reached");
  });

  it("marks never-recorded repos unmeasured", () => {
    const never = coverageBands({ fresh: 0, total: 3, wentQuiet: 0, neverRecorded: 3 }).find((s) => s.key === "never");
    expect(never?.state).toBe("unmeasured");
    expect(never?.detail).toBe("3 repos");
  });

  it("does not turn a missing model into zero proposals", () => {
    const proposals = reflectLadder({ consideredCount: 4, clusterCount: 1, proposalCount: 0, llmUnavailable: true }).find(
      (s) => s.key === "proposals",
    );
    expect(proposals?.state).toBe("unmeasured");
    expect(proposals?.detail).toBe("no engine");
  });

  it("keeps a counted zero factor open", () => {
    expect(factorState(0)).toBe("open");
    expect(factorState(Number.NaN)).toBe("unmeasured");
    expect(factorState(0.9)).toBe("reached");
  });

  it("caps the named stale repos", () => {
    const repos = Array.from({ length: 7 }, (_, i) => ({ fullName: `acme/${i}`, lastMemoryAt: null }));
    expect(staleWindow(repos).shown).toHaveLength(5);
    expect(staleWindow(repos).more).toBe(2);
    expect(staleWindow(repos).neverRecorded).toBe(7);
  });

  it("does not score a filtered recall row", () => {
    expect(ineligibleCell("filtered")).toBe("unmeasured");
    expect(ineligibleCell("superseded")).toBe("missing");
  });
});
