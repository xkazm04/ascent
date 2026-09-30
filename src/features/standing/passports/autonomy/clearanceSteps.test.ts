// Ladder steps for the clearance register and the per-repo rail. Counts stay counts.
// A placeholder band does not print its population as a measurement.
import { describe, expect, it } from "vitest";
import { clearanceBands, clearanceEdge } from "./clearanceLadder";
import { clearanceLadderSteps, tierRailSteps } from "./clearanceSteps";
import type { RepoAutonomy } from "./autonomyModel";
import type { AutonomyTier } from "./autonomyTiers";

const repo = (name: string, tier: AutonomyTier, engine: string | null = "claude"): RepoAutonomy =>
  ({ fullName: `acme/${name}`, name, tier, engine }) as RepoAutonomy;

const step = (steps: { key: string; state: string; detail?: unknown }[], key: string) => steps.find((s) => s.key === key)!;

describe("clearanceLadderSteps", () => {
  it("reads T0 to T3, with an empty measured tier open at 0", () => {
    const repos = [repo("a", 0), repo("b", 2), repo("c", 2)];
    const steps = clearanceLadderSteps(clearanceBands(repos), clearanceEdge(repos));
    expect(steps.map((s) => s.key)).toEqual(["t0", "t1", "t2", "t3"]);
    expect(step(steps, "t2")).toMatchObject({ state: "reached", detail: "2 repos, Refactors with review" });
    expect(step(steps, "t0")).toMatchObject({ state: "reached", detail: "1 repo, Observe only" });
    expect(step(steps, "t3").state).toBe("open");
    expect(String(step(steps, "t3").detail)).toContain("0 repos");
  });

  it("hides the count on a placeholder-only tier and names the edge", () => {
    const repos = [repo("a", 1, "mock"), repo("b", 1, "mock"), repo("c", 3)];
    const steps = clearanceLadderSteps(clearanceBands(repos), clearanceEdge(repos));
    expect(step(steps, "t1").state).toBe("unmeasured");
    expect(String(step(steps, "t1").detail)).not.toMatch(/\d/);
    expect(step(steps, "placeholder")).toMatchObject({
      state: "unmeasured",
      detail: "2 issued on a placeholder scan",
    });
  });
});

describe("tierRailSteps", () => {
  it("marks rungs below the held tier reached and the held tier current", () => {
    const steps = tierRailSteps(2, "claude");
    expect(steps.map((s) => s.state)).toEqual(["reached", "reached", "current", "open"]);
    expect(steps[2]!.detail).toBe("Refactors with review");
  });

  it("marks a placeholder floor as not measured, including the rungs it contains", () => {
    const steps = tierRailSteps(1, "mock");
    expect(steps.map((s) => s.state)).toEqual(["unmeasured", "unmeasured", "open", "open"]);
    expect(steps[1]!.detail).toBe("Tests & docs");
  });
});
