// The clearance perimeter that replaced the register's 224-character lede. The band a repo holds is a
// measurement; a clearance issued off a deterministic placeholder scan is not, and the ladder has to
// keep the two apart without a footnote.

import { describe, expect, it } from "vitest";
import { clearanceBands, clearanceEdge, clearanceStates } from "./clearanceLadder";
import type { RepoAutonomy } from "./autonomyModel";
import type { AutonomyTier } from "./autonomyTiers";

const repo = (name: string, tier: AutonomyTier, engine: string | null = "claude"): RepoAutonomy =>
  ({ fullName: `acme/${name}`, name, tier, engine }) as RepoAutonomy;

describe("clearanceBands", () => {
  it("orders the bands outermost-first — most permissive to least", () => {
    expect(clearanceBands([]).map((b) => b.id)).toEqual(["t3", "t2", "t1", "t0"]);
  });

  it("counts the repos holding each clearance", () => {
    const bands = clearanceBands([repo("a", 0), repo("b", 2), repo("c", 2)]);
    expect(bands.find((b) => b.id === "t2")!.count).toBe(2);
    expect(bands.find((b) => b.id === "t0")!.count).toBe(1);
    expect(bands.every((b) => b.state === "measured")).toBe(true);
  });

  it("hatches a band whose every holder was scored by the placeholder engine", () => {
    const bands = clearanceBands([repo("a", 1, "mock"), repo("b", 1, "mock"), repo("c", 3)]);
    expect(bands.find((b) => b.id === "t1")!.state).toBe("not-judged");
    // Mixed evidence keeps the band a measurement; the placeholders are counted on the edge instead.
    expect(bands.find((b) => b.id === "t3")!.state).toBe("measured");
  });

  it("does not hatch an EMPTY band — nobody holding a clearance is a measurement, not an absence", () => {
    expect(clearanceBands([repo("a", 0)]).find((b) => b.id === "t3")!.state).toBe("measured");
  });
});

describe("clearanceEdge", () => {
  it("is absent when every clearance rests on a graded scan", () => {
    expect(clearanceEdge([repo("a", 1), repo("b", 2)])).toBeNull();
  });

  it("counts the clearances issued on a placeholder scan as crossing the perimeter", () => {
    expect(clearanceEdge([repo("a", 1, "mock"), repo("b", 2)])).toEqual({
      label: "issued on a placeholder scan",
      count: 1,
      state: "not-judged",
    });
  });
});

describe("clearanceStates", () => {
  it("lists only what the ladder draws", () => {
    const graded = [repo("a", 1), repo("b", 2)];
    expect(clearanceStates(clearanceBands(graded), clearanceEdge(graded))).toEqual(["measured"]);
    const mixed = [repo("a", 1, "mock"), repo("b", 2)];
    expect(clearanceStates(clearanceBands(mixed), clearanceEdge(mixed))).toEqual(["measured", "not-judged"]);
  });
});
