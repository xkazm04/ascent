import { describe, it, expect } from "vitest";
import { governanceMarkdown, type GovernanceOverview } from "./governance";
import { defaultGatePolicy, evaluateGateLite } from "@/lib/scoring/gate";

describe("evaluateGateLite", () => {
  const orgPolicy = defaultGatePolicy("org"); // { minLevel: L3, minDimension: 40, forbidPostures: [ungoverned] }

  it("reports every failing condition with the right codes", () => {
    const res = evaluateGateLite(
      { level: "L2", overall: 55, posture: "ungoverned", dims: [{ dimId: "D1", score: 30 }, { dimId: "D9", score: 70 }] },
      orgPolicy,
    );
    expect(res.pass).toBe(false);
    expect([...res.failures.map((f) => f.code)].sort()).toEqual(["dimension", "level", "posture"]);
    expect(res.failures.find((f) => f.code === "dimension")?.message).toContain("D1");
    expect(res.failures.find((f) => f.code === "dimension")?.message).toContain("30");
  });

  it("passes a repo that clears the org bar", () => {
    const res = evaluateGateLite(
      { level: "L4", overall: 82, posture: "governed", dims: [{ dimId: "D1", score: 61 }, { dimId: "D9", score: 75 }] },
      orgPolicy,
    );
    expect(res.pass).toBe(true);
    expect(res.failures).toHaveLength(0);
  });
});

const fixture: GovernanceOverview = {
  org: "acme",
  generatedOn: "2026-06-09",
  policyText: ["Minimum overall level L3", "Every dimension ≥ 40", 'No "ungoverned" posture'],
  scanned: 10,
  passing: 7,
  failing: 3,
  passRate: 70,
  byReason: { level: 2, overall: 0, dimension: 3, posture: 1 },
  failures: [
    {
      name: "web",
      fullName: "acme/web",
      level: "L2",
      overall: 48,
      reasons: ["Level L2 is below the required L3.", "D9 Supply Chain & Security scored 30, below the required 40."],
    },
  ],
  closestToGreen: [
    {
      name: "web",
      fullName: "acme/web",
      failCount: 2,
      gap: 10,
      dims: [{ dimId: "D9", name: "Supply Chain & Security", score: 30, floor: 40, gap: 10, practiceId: "supply-chain" }],
      blockers: ["Level L2 is below the required L3."],
    },
  ],
  gateQuery: "min_level=L3&min_dimension=40&no_ungoverned=1",
  ciWith: ["min-level: L3", "min-dimension: '40'", "no-ungoverned: 'true'"],
};

describe("governanceMarkdown", () => {
  const md = governanceMarkdown(fixture);

  it("states the policy and fleet status", () => {
    expect(md).toContain("## Policy (applied to every repo)");
    expect(md).toContain("- Minimum overall level L3");
    expect(md).toContain("7/10 repos PASS the gate (70%)");
    expect(md).toContain("Failing on: 2 below level · 3 dimension floor · 1 posture");
  });

  it("lists failing repos with their specific conditions", () => {
    expect(md).toContain("acme/web (L2, overall 48)");
    expect(md).toContain("Level L2 is below the required L3.");
  });

  it("includes the CI enforcement (same policy as the dashboard)", () => {
    expect(md).toContain("min_level=L3&min_dimension=40&no_ungoverned=1");
    expect(md).toContain("ascent-url: ${{ vars.ASCENT_URL }}");
    expect(md).toContain("min-level: L3");
    expect(md).toContain("no-ungoverned: 'true'");
  });

  it("ends with a cheapest-path-to-green ASK", () => {
    expect(md).toContain("## Ask");
    expect(md).toMatch(/cheapest path/);
  });
});
