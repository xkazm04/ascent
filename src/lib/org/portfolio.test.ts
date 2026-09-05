import { describe, it, expect } from "vitest";
import { topPosture, summarizePortfolio, type PortfolioCompany } from "./portfolio";

const co = (
  org: string,
  avgOverall: number,
  trajectory: PortfolioCompany["trajectory"],
  scannedCount = 5,
): PortfolioCompany => ({
  org,
  scannedCount,
  avgOverall,
  levelId: "L3",
  levelName: "Managed",
  adoption: 50,
  rigor: 50,
  posture: "manual",
  trajectory,
  perWeek: 0,
  etaLabel: null,
  confidence: null,
  percentile: null,
});

describe("topPosture", () => {
  it("picks the posture with the most repos", () => {
    expect(topPosture({ "ai-native": 2, manual: 5, early: 1 })).toBe("manual");
  });
  it("returns a dash for an empty fleet", () => {
    expect(topPosture({})).toBe("—");
  });
});

describe("summarizePortfolio", () => {
  it("sorts richest-first, means maturity, and splits rising/falling/flat (null trend = flat)", () => {
    const p = summarizePortfolio([co("a", 50, "rising"), co("b", 80, "falling"), co("c", 60, null)]);
    expect(p.companies.map((c) => c.org)).toEqual(["b", "c", "a"]); // 80, 60, 50
    expect(p.avgOverall).toBe(63); // round((50+80+60)/3)
    expect(p.rising).toBe(1);
    expect(p.falling).toBe(1);
    expect(p.flat).toBe(1); // c has no fittable trend
    expect(p.totalRepos).toBe(15);
  });
  it("is empty-safe", () => {
    expect(summarizePortfolio([])).toMatchObject({ avgOverall: 0, rising: 0, falling: 0, flat: 0, totalRepos: 0 });
  });
});
