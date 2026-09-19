import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  getOrgRollup: vi.fn(),
  getOrgBenchmark: vi.fn(),
}));

import { getOrgBenchmark, getOrgRollup } from "@/lib/db";
import {
  buildPortfolio,
  PORTFOLIO_EMPTY_COPY,
  portfolioEmptyKind,
  summarizePortfolio,
  topPosture,
  type PortfolioCompany,
} from "./portfolio";

const mockRollup = vi.mocked(getOrgRollup);
const mockBenchmark = vi.mocked(getOrgBenchmark);

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

function rollup(
  org: string,
  averages: { overall: number | null; adoption: number | null; rigor: number | null },
  scannedCount = 3,
) {
  return {
    org,
    scannedCount,
    avgOverall: averages.overall,
    avgAdoption: averages.adoption,
    avgRigor: averages.rigor,
    postureCounts: scannedCount ? { manual: scannedCount } : {},
    forecast: null,
  };
}

describe("buildPortfolio — a miss is tagged, not dropped into one empty", () => {
  beforeEach(() => {
    mockRollup.mockReset();
    mockBenchmark.mockReset();
    mockBenchmark.mockResolvedValue(null);
  });

  it("keeps a live-scored org as a company row", async () => {
    mockRollup.mockResolvedValue(rollup("acme", { overall: 70, adoption: 40, rigor: 50 }) as never);
    const read = await buildPortfolio(["acme"]);
    expect(read.portfolio.companies.map((c) => c.org)).toEqual(["acme"]);
    expect(read.empty).toEqual([]);
    expect(read.unavailable).toEqual([]);
  });

  it("tags a successful rollup with no fleet grade as empty, not unavailable", async () => {
    mockRollup.mockResolvedValue(rollup("quiet", { overall: null, adoption: null, rigor: null }, 0) as never);
    const read = await buildPortfolio(["quiet"]);
    expect(read.portfolio.companies).toEqual([]);
    expect(read.empty).toEqual(["quiet"]);
    expect(read.unavailable).toEqual([]);
  });

  it("tags a mock-only fleet as empty (scanned, not graded), not as a read failure", async () => {
    mockRollup.mockResolvedValue(rollup("demo", { overall: null, adoption: null, rigor: null }, 4) as never);
    const read = await buildPortfolio(["demo"]);
    expect(read.empty).toEqual(["demo"]);
    expect(read.unavailable).toEqual([]);
  });

  it("tags a thrown rollup as unavailable, not as no scans", async () => {
    mockRollup.mockRejectedValue(new Error("too many clients"));
    const read = await buildPortfolio(["boom"]);
    expect(read.portfolio.companies).toEqual([]);
    expect(read.empty).toEqual([]);
    expect(read.unavailable).toEqual(["boom"]);
  });

  it("tags a null rollup (persistence off / missing org) as unavailable, not empty", async () => {
    mockRollup.mockResolvedValue(null);
    const read = await buildPortfolio(["gone"]);
    expect(read.empty).toEqual([]);
    expect(read.unavailable).toEqual(["gone"]);
  });

  it("does not collapse a thrown rollup and an ungraded fleet into the same bucket", async () => {
    mockRollup.mockImplementation(async (org: string) => {
      if (org === "boom") throw new Error("too many clients");
      return rollup("quiet", { overall: null, adoption: null, rigor: null }, 0) as never;
    });
    const read = await buildPortfolio(["boom", "quiet"]);
    expect(read.unavailable).toEqual(["boom"]);
    expect(read.empty).toEqual(["quiet"]);
    expect(read.portfolio.companies).toEqual([]);
  });
});

const G4_EMPTY = ["no-access", "no-scans", "read-failure"] as const;

describe("portfolioEmptyKind — no-access vs no-scans vs read-failure do not share one empty", () => {
  it("returns null when the table has companies", () => {
    expect(
      portfolioEmptyKind({ requested: 2, readable: 2, companies: 1, empty: 0, unavailable: 0 }),
    ).toBeNull();
  });

  it("prompts when nothing was requested", () => {
    expect(
      portfolioEmptyKind({ requested: 0, readable: 0, companies: 0, empty: 0, unavailable: 0 }),
    ).toBe("prompt");
  });

  it("is no-access when every requested org was unreadable", () => {
    expect(
      portfolioEmptyKind({ requested: 3, readable: 0, companies: 0, empty: 0, unavailable: 0 }),
    ).toBe("no-access");
  });

  it("is no-scans when readable orgs resolved and none had a fleet grade", () => {
    expect(
      portfolioEmptyKind({ requested: 2, readable: 2, companies: 0, empty: 2, unavailable: 0 }),
    ).toBe("no-scans");
  });

  it("is read-failure when readable orgs could not be read", () => {
    expect(
      portfolioEmptyKind({ requested: 2, readable: 2, companies: 0, empty: 0, unavailable: 2 }),
    ).toBe("read-failure");
  });

  it("does not call a mixed empty+unavailable miss 'no scans' (a failed read is not absence)", () => {
    expect(
      portfolioEmptyKind({ requested: 2, readable: 2, companies: 0, empty: 1, unavailable: 1 }),
    ).toBe("read-failure");
  });

  it("keeps no-access, no-scans, and read-failure on three distinct copies", () => {
    const titles = G4_EMPTY.map((k) => PORTFOLIO_EMPTY_COPY[k].title);
    const bodies = G4_EMPTY.map((k) => PORTFOLIO_EMPTY_COPY[k].body);
    expect(new Set(titles).size).toBe(3);
    expect(new Set(bodies).size).toBe(3);
    expect(titles).toEqual(["No read access", "No scans yet", "Portfolio unavailable"]);
    expect(PORTFOLIO_EMPTY_COPY["no-access"].body).not.toMatch(/or none have scanned/i);
    expect(PORTFOLIO_EMPTY_COPY["no-scans"].body).not.toMatch(/not readable|could not be read|unavailable/i);
    expect(PORTFOLIO_EMPTY_COPY["read-failure"].body).not.toMatch(/no scans yet/i);
  });
});
