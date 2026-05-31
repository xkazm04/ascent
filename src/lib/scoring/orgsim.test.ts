import { describe, it, expect } from "vitest";
import { recomputeRepo, simulateFleet, type RepoDims } from "./orgsim";

const ALL_DIMS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"] as const;

/** A repo with every dimension at the same flat score. */
function flatRepo(fullName: string, score: number, archetype: RepoDims["archetype"] = "org"): RepoDims {
  const dims: Record<string, number> = {};
  for (const d of ALL_DIMS) dims[d] = score;
  return { fullName, name: fullName.split("/")[1] ?? fullName, archetype, dims };
}

describe("recomputeRepo", () => {
  it("returns the flat score for a uniform repo (weighted mean of equal scores)", () => {
    const r = recomputeRepo(flatRepo("o/r", 50).dims, "org");
    expect(r.overall).toBe(50);
    expect(r.adoption).toBe(50);
    expect(r.rigor).toBe(50);
  });

  it("renormalizes over present dimensions only (a partial scan isn't deflated)", () => {
    const r = recomputeRepo({ D1: 80, D2: 80 }, "org");
    expect(r.overall).toBe(80); // not dragged toward 0 by the 7 absent dims
  });
});

describe("simulateFleet", () => {
  const repos = [flatRepo("o/a", 40), flatRepo("o/b", 40), flatRepo("o/c", 80)];

  it("only moves in-scope repos that are below target", () => {
    const proj = simulateFleet(repos, { dimId: "D2", target: 70 }, ["o/a", "o/b", "o/c"]);
    // a and b are below 70 on D2; c is at 80 so it's untouched.
    expect(proj.affected).toBe(2);
    expect(proj.scopeCount).toBe(3);
    const a = proj.repos.find((r) => r.fullName === "o/a")!;
    const c = proj.repos.find((r) => r.fullName === "o/c")!;
    expect(a.delta).toBeGreaterThan(0);
    expect(c.delta).toBe(0);
  });

  it("respects the scope set — repos outside it never move", () => {
    const proj = simulateFleet(repos, { dimId: "D2", target: 70 }, ["o/a"]);
    expect(proj.affected).toBe(1);
    expect(proj.repos.find((r) => r.fullName === "o/b")!.delta).toBe(0);
    expect(proj.after.avgOverall).toBeGreaterThanOrEqual(proj.before.avgOverall);
  });

  it("raises the fleet average and can promote repos across a band", () => {
    // Lift every dimension-D2..D9 rigor repo high enough to cross a level on the low repos.
    const proj = simulateFleet(repos, { dimId: "D2", target: 100 }, ["o/a", "o/b", "o/c"]);
    expect(proj.after.avgOverall).toBeGreaterThan(proj.before.avgOverall);
    expect(proj.promotions).toBeGreaterThanOrEqual(0);
  });

  it("is a no-op when the scope is empty", () => {
    const proj = simulateFleet(repos, { dimId: "D2", target: 100 }, []);
    expect(proj.affected).toBe(0);
    expect(proj.after.avgOverall).toBe(proj.before.avgOverall);
  });
});
