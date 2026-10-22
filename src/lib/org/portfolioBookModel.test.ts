import { describe, expect, it } from "vitest";
import { bookToggleHref, portfolioMatrix, resolveBook, showPortfolioEntry } from "./portfolioBookModel";
import type { PortfolioCompany } from "./portfolio";

const co = (org: string, dims: Record<string, number>): PortfolioCompany => ({
  org,
  scannedCount: 3,
  realScoredCount: 3,
  mockCount: 0,
  dims,
  avgOverall: 50,
  levelId: "L3",
  levelName: "Managed",
  adoption: 50,
  rigor: 50,
  posture: "manual",
  trajectory: null,
  perWeek: null,
  etaLabel: null,
  confidence: null,
  percentile: null,
});

describe("resolveBook - the default book is the viewer's readable workspace", () => {
  it("seeds from workspace options, lowercased, never adding public implicitly", () => {
    expect(resolveBook({ requested: [], explicit: false, workspaceOptions: ["acme", "Beta", "public"] })).toEqual({
      orgs: ["acme", "beta"],
      source: "workspace",
    });
  });

  it("an explicit ?orgs wins over the workspace", () => {
    expect(resolveBook({ requested: ["x"], explicit: true, workspaceOptions: ["acme"] })).toEqual({
      orgs: ["x"],
      source: "query",
    });
  });

  it("an explicitly emptied book stays empty (the prompt), not refilled from the workspace", () => {
    expect(resolveBook({ requested: [], explicit: true, workspaceOptions: ["acme"] })).toEqual({
      orgs: [],
      source: "query",
    });
  });
});

describe("bookToggleHref - one click includes or excludes a company", () => {
  it("removes an included org", () => {
    expect(bookToggleHref(["acme", "beta"], "beta")).toBe("/portfolio?orgs=acme");
  });
  it("appends an excluded org", () => {
    expect(bookToggleHref(["acme"], "beta")).toBe("/portfolio?orgs=acme%2Cbeta");
  });
  it("removing the last org leaves an explicit empty book", () => {
    expect(bookToggleHref(["acme"], "acme")).toBe("/portfolio?orgs=");
  });
});

describe("portfolioMatrix - weakest dimension per company and across the book", () => {
  it("names each company's lowest PRESENT dim, ties broken by DIMENSIONS order", () => {
    const m = portfolioMatrix([co("a", { D1: 60, D3: 20 }), co("b", { D2: 40, D1: 40 })]);
    expect(m.rows.find((r) => r.org === "a")?.weakest).toBe("D3");
    expect(m.rows.find((r) => r.org === "b")?.weakest).toBe("D1");
  });

  it("a company with no dims has no weakest (absence, not 0)", () => {
    const m = portfolioMatrix([co("a", {})]);
    expect(m.rows[0]?.weakest).toBeNull();
    expect(m.bookGap).toBeNull();
  });

  it("the book gap is the lowest one-vote-per-company mean, carrying n", () => {
    const m = portfolioMatrix([co("a", { D1: 60, D4: 30 }), co("b", { D1: 50, D4: 10 }), co("c", { D1: 70 })]);
    expect(m.bookGap).toMatchObject({ dimId: "D4", mean: 20, n: 2, weakestIn: 2 });
  });

  it("a dim present in 1 of 3 companies reports n 1 and is not chosen over one with n >= 2", () => {
    const m = portfolioMatrix([co("a", { D1: 60, D9: 5 }), co("b", { D1: 50 }), co("c", { D1: 40 })]);
    expect(m.means.D9).toEqual({ mean: 5, n: 1 });
    expect(m.bookGap?.dimId).toBe("D1");
    expect(m.bookGap?.n).toBe(3);
  });

  it("columns follow DIMENSIONS order", () => {
    expect(portfolioMatrix([]).dimIds.slice(0, 3)).toEqual(["D1", "D2", "D3"]);
  });
});

describe("showPortfolioEntry - the identity menu entry", () => {
  it("shows for two or more non-public orgs only", () => {
    expect(showPortfolioEntry(["acme", "public"])).toBe(false);
    expect(showPortfolioEntry(["acme", "beta", "public"])).toBe(true);
    expect(showPortfolioEntry(["acme", "ACME", "public"])).toBe(false);
  });
});
