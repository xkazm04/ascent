import { describe, it, expect } from "vitest";
import { recomputeRepo, simulateFleet, type RepoDims } from "./orgsim";
import { axisScore, postureFor } from "@/lib/maturity/model";

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

  it("normalizes a single fix into a one-element fixes list", () => {
    const proj = simulateFleet(repos, { dimId: "D2", target: 70 }, ["o/a"]);
    expect(proj.fixes).toEqual([{ dimId: "D2", target: 70 }]);
  });

  describe("multi-dimension scenario (SIM-2)", () => {
    it("applies every leg and lifts more than a single leg alone", () => {
      const scope = ["o/a", "o/b", "o/c"];
      const one = simulateFleet(repos, { dimId: "D2", target: 70 }, scope);
      const two = simulateFleet(repos, [{ dimId: "D2", target: 70 }, { dimId: "D3", target: 70 }], scope);
      // Raising two dimensions can only help the fleet average at least as much as one.
      expect(two.after.avgOverall).toBeGreaterThanOrEqual(one.after.avgOverall);
      expect(two.fixes).toHaveLength(2);
    });

    it("counts a repo as affected when any leg moves it", () => {
      // o/c is at 80: a 70-target leg leaves it alone, but a 90-target leg moves it.
      const proj = simulateFleet(repos, [{ dimId: "D2", target: 70 }, { dimId: "D3", target: 90 }], ["o/c"]);
      expect(proj.affected).toBe(1);
      expect(proj.repos.find((r) => r.fullName === "o/c")!.delta).toBeGreaterThan(0);
    });

    it("never lowers a dimension already above a leg's target", () => {
      // Every dim on o/c is 80; a 70 target must not pull it down.
      const proj = simulateFleet(repos, [{ dimId: "D2", target: 70 }], ["o/c"]);
      expect(proj.repos.find((r) => r.fullName === "o/c")!.delta).toBe(0);
    });
  });
});

/**
 * KNOWN BUG (documented, NOT fixed here) — present-dims policy divergence between `overall` and
 * the axis/posture scores for a PARTIALLY-scanned repo.
 *
 * See docs/harness/test-mastery-2026-06-18/investment-simulator-forecast.md finding #1 (Critical).
 *
 * `recomputeRepo.overall` renormalizes its weighted mean over the dimensions ACTUALLY PRESENT
 * (orgsim.ts:72-76), so a partial scan isn't deflated. But `adoption`/`rigor` come from
 * `axisScore` (model.ts:245), which divides by the FULL axis weight sum and treats every ABSENT
 * dimension as `scoreFor → 0` carrying its full weight. So a repo that is genuinely L4 on
 * `overall` shows a deflated `adoption`/`rigor`, which flips `postureFor` into the wrong (worst)
 * band — corrupting `before.postureCounts`/`after.postureCounts` in the fleet simulator.
 *
 * The tests below PIN THE REAL CURRENT BEHAVIOR (the bug), so a future fix that renormalizes
 * `axisScore` over present dims becomes a deliberate, test-visible change — these exact numbers
 * will then break and must be updated alongside the fix.
 */
describe("recomputeRepo — partial-scan axis/overall divergence (KNOWN BUG, pinned)", () => {
  // A partially-scanned "org" repo: only D1 (adoption) and D2 (rigor) persisted, both = 80.
  // Every PRESENT dimension is well above POSTURE_THRESHOLD (50), so a renormalized policy would
  // place this repo firmly in the "ai-native" posture. The non-renormalized axisScore does not.
  const partial: Record<string, number> = { D1: 80, D2: 80 };

  it("renormalizes overall over present dims — partial repo is NOT deflated (overall = 80)", () => {
    const r = recomputeRepo(partial, "org");
    expect(r.overall).toBe(80); // both present dims are 80 → weighted mean is 80
  });

  it("BUG: axis scores treat absent dims as 0 full-weight, deflating adoption/rigor far below overall", () => {
    const r = recomputeRepo(partial, "org");
    // Hand-derived under the "org" lens:
    //   adoption dims = D1(0.15), D4(0.12), D7(0.07); wsum = 0.34.
    //     present: D1=80 → sum = 80*0.15 = 12; absent D4,D7 = 0.
    //     axisScore = round(12 / 0.34) = round(35.29) = 35
    //   rigor dims = D2(0.15),D3(0.14),D5(0.09),D6(0.07),D8(0.12),D9(0.09); wsum = 0.66.
    //     present: D2=80 → sum = 80*0.15 = 12; rest = 0.
    //     axisScore = round(12 / 0.66) = round(18.18) = 18
    // These are deflated FAR below the renormalized overall of 80 — the documented defect.
    expect(r.adoption).toBe(35);
    expect(r.rigor).toBe(18);
    expect(r.overall).toBe(80);

    // The divergence itself, pinned: both axes are well below overall purely because absent
    // dims were charged at 0. A correct (renormalized) axisScore would yield 80/80 here.
    expect(r.overall - r.adoption).toBe(45);
    expect(r.overall - r.rigor).toBe(62);
  });

  it("BUG: recomputeRepo's axes match the standalone axisScore (same non-renormalized policy)", () => {
    const r = recomputeRepo(partial, "org");
    const scoreFor = (id: string) => partial[id] ?? 0;
    // recomputeRepo derives adoption/rigor by calling axisScore directly, so they must agree.
    expect(r.adoption).toBe(axisScore("adoption", scoreFor as never, "org"));
    expect(r.rigor).toBe(axisScore("rigor", scoreFor as never, "org"));
  });

  it("BUG: postureFor on the partial repo FLIPS to 'early' even though overall = 80 (L4)", () => {
    const r = recomputeRepo(partial, "org");
    // adoption=35 (<50) and rigor=18 (<50) → both axes below POSTURE_THRESHOLD → worst bucket.
    // A renormalized policy would have placed an all-present-≥50 repo in "ai-native".
    expect(postureFor(r.adoption, r.rigor).id).toBe("early");
    // Sanity: the headline overall of this very same repo is firmly L4-Integrated territory.
    expect(r.overall).toBeGreaterThanOrEqual(65);
  });

  it("simulateFleet buckets the partial repo into the (flipped) 'early' posture in before/after", () => {
    const partialRepo: RepoDims = { fullName: "o/partial", name: "partial", archetype: "org", dims: partial };
    const proj = simulateFleet([partialRepo], { dimId: "D2", target: 100 }, ["o/partial"]);
    // Even after raising D2 to 100, rigor only rises to round((100*0.15)/0.66)=23 — still <50 —
    // so the repo stays mis-bucketed in "early": the fleet posture mix inherits the axis bug.
    expect(proj.before.postureCounts).toEqual({ early: 1 });
    expect(proj.after.postureCounts).toEqual({ early: 1 });
  });

  it("CONTROL: an all-dims-present repo at 80 — axis and overall AGREE, posture is 'ai-native'", () => {
    // The case existing tests already cover, asserted explicitly as the cross-check: when every
    // dimension is present, the renormalized overall and the (non-renormalized) axes coincide,
    // and posture lands in the correct band. The divergence above is SOLELY a partial-scan artifact.
    const r = recomputeRepo(flatRepo("o/full", 80).dims, "org");
    expect(r.overall).toBe(80);
    expect(r.adoption).toBe(80);
    expect(r.rigor).toBe(80);
    expect(postureFor(r.adoption, r.rigor).id).toBe("ai-native");
  });
});
