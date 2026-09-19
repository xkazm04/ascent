import { describe, expect, it } from "vitest";
import { aggregateLift, liftKey, type LiftDistribution, type OutcomeSample } from "@/lib/outcomes/aggregate";
import { expectedLiftClause, measuredRank } from "@/lib/outcomes/expected-lift";

const dist = (over: Partial<LiftDistribution> = {}): LiftDistribution => ({
  identityKey: "D2:1a2b3c4d",
  dimId: "D2",
  n: 37,
  orgs: 12,
  medianDim: 11,
  p25: 6,
  p75: 15,
  medianOverall: 4,
  instrument: { rubricVersion: "r10", engineProvider: "claude" },
  ...over,
});

describe("expectedLiftClause — G4: absence never degrades to a number", () => {
  it("returns null for no distribution, never '+0'", () => {
    expect(expectedLiftClause(null)).toBeNull();
    expect(expectedLiftClause(undefined)).toBeNull();
  });

  it("zero measured samples yields null — the whole path from an empty ledger", () => {
    const lifts = aggregateLift([] as OutcomeSample[], { scope: "org" });
    expect(expectedLiftClause(lifts.get("anything"))).toBeNull();
  });

  it("an under-floor distribution built by hand is still refused at this end", () => {
    expect(expectedLiftClause(dist({ n: 2 }))).toBeNull();
    expect(measuredRank(dist({ n: 2 }))).toBeNull();
  });

  it("a MEASURED zero is published — it is a finding, not an absence", () => {
    const c = expectedLiftClause(dist({ medianDim: 0, p25: 0, p75: 0 }));
    expect(c).toContain("D2 0 median");
    expect(c).toContain("37 measured closes");
  });
});

describe("expectedLiftClause — the number never travels without its basis", () => {
  it("carries the median, the sample count AND the instrument in one string", () => {
    const c = expectedLiftClause(dist())!;
    expect(c).toBe("D2 +11 median (IQR +6…+15) across 37 measured closes · r10 · claude");
    // The three things that qualify the number are all in the same value a caller renders.
    expect(c).toContain("37");
    expect(c).toContain("r10");
    expect(c).toContain("claude");
  });

  it("there is no way to obtain the median without the count — the module exports no bare formatter", async () => {
    const mod = await import("@/lib/outcomes/expected-lift");
    expect(Object.keys(mod).sort()).toEqual(["expectedLiftClause", "measuredRank"]);
  });

  it("omits the IQR when the partition has no per-dimension deltas, and falls back to overall", () => {
    const c = expectedLiftClause(dist({ medianDim: null, p25: null, p75: null }))!;
    expect(c).toBe("overall +4 median across 37 measured closes · r10 · claude");
    expect(c).not.toContain("IQR");
  });

  it("a whole-scan outcome (dimId null) never invents a dimension label", () => {
    const c = expectedLiftClause(dist({ dimId: null, medianDim: null, p25: null, p75: null }))!;
    expect(c.startsWith("overall ")).toBe(true);
  });

  it("signs a negative median rather than dropping the direction", () => {
    expect(expectedLiftClause(dist({ medianDim: -3, p25: -6, p75: -1 }))).toContain("D2 -3 median (IQR -6…-1)");
  });

  it("singularizes at n = 1 — which only the floor-free path can reach", () => {
    expect(expectedLiftClause(dist({ n: 3 }))).toContain("3 measured closes");
  });

  it("renders a half-point median from an even-length set without lying about precision", () => {
    expect(expectedLiftClause(dist({ medianDim: 5.5 }))).toContain("+5.5 median");
  });
});

describe("measuredRank", () => {
  it("is null (never 0) with no distribution, so a sort can fall back", () => {
    expect(measuredRank(null)).toBeNull();
    expect(measuredRank(undefined)).toBeNull();
  });

  it("prefers the dimension median and falls back to the overall median", () => {
    expect(measuredRank(dist())).toBe(11);
    expect(measuredRank(dist({ medianDim: null }))).toBe(4);
  });

  it("keeps a negative rank negative", () => {
    expect(measuredRank(dist({ medianDim: -7 }))).toBe(-7);
  });
});

describe("aggregate → clause, end to end", () => {
  const sample = (over: Partial<OutcomeSample> = {}): OutcomeSample => ({
    orgId: "org_1",
    identityKey: "D2:abcd1234",
    dimId: "D2",
    overallDelta: 3,
    dimDelta: 10,
    rubricVersion: "r10",
    engineProvider: "claude",
    isPrivateRepo: false,
    ...over,
  });

  it("three org-scoped samples produce a clause; two produce nothing", () => {
    const key = liftKey("D2:abcd1234", "D2", { rubricVersion: "r10", engineProvider: "claude" });
    const two = aggregateLift([sample(), sample()], { scope: "org" });
    expect(expectedLiftClause(two.get(key))).toBeNull();
    const three = aggregateLift([sample(), sample(), sample()], { scope: "org" });
    expect(expectedLiftClause(three.get(key))).toBe(
      "D2 +10 median (IQR +10…+10) across 3 measured closes · r10 · claude",
    );
  });
});
