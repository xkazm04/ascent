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
 * Present-dims policy CONSISTENCY between `overall` and the axis/posture scores for a
 * PARTIALLY-scanned repo.
 *
 * `recomputeRepo.overall` renormalizes its weighted mean over the dimensions ACTUALLY PRESENT
 * (orgsim.ts), so a partial scan isn't deflated. `adoption`/`rigor` now come from `axisScore`
 * (model.ts) renormalized over present dims TOO (via the `isPresent` predicate recomputeRepo
 * passes), so an absent dimension is excluded from both the weighted sum and the weight
 * denominator instead of being charged at 0 with full weight. A repo that is genuinely L4 on
 * `overall` therefore shows matching `adoption`/`rigor` and lands in the correct posture band.
 */
describe("recomputeRepo — partial-scan axis/overall consistency (renormalized over present dims)", () => {
  // A partially-scanned "org" repo: only D1 (adoption) and D2 (rigor) persisted, both = 80.
  // Every PRESENT dimension is well above POSTURE_THRESHOLD (50), and renormalization over present
  // dims places this repo firmly in the "ai-native" posture — axes agree with overall.
  const partial: Record<string, number> = { D1: 80, D2: 80 };

  it("renormalizes overall over present dims — partial repo is NOT deflated (overall = 80)", () => {
    const r = recomputeRepo(partial, "org");
    expect(r.overall).toBe(80); // both present dims are 80 → weighted mean is 80
  });

  it("renormalizes axis scores over present dims too — adoption/rigor match overall", () => {
    const r = recomputeRepo(partial, "org");
    // Hand-derived under the "org" lens, renormalizing over PRESENT dims only:
    //   adoption present dims = D1(0.15) [D4,D7 absent → excluded]; wsum = 0.15.
    //     sum = 80*0.15 = 12 → axisScore = round(12 / 0.15) = round(80) = 80
    //   rigor present dims = D2(0.15) [D3,D5,D6,D8,D9 absent → excluded]; wsum = 0.15.
    //     sum = 80*0.15 = 12 → axisScore = round(12 / 0.15) = round(80) = 80
    // Both axes now equal the renormalized overall of 80 — no deflation from absent dims.
    expect(r.adoption).toBe(80);
    expect(r.rigor).toBe(80);
    expect(r.overall).toBe(80);

    // Axes and overall agree exactly: absent dims no longer charged at 0.
    expect(r.overall - r.adoption).toBe(0);
    expect(r.overall - r.rigor).toBe(0);
  });

  it("recomputeRepo's axes match a present-dims-renormalized axisScore", () => {
    const r = recomputeRepo(partial, "org");
    const scoreFor = (id: string) => partial[id] ?? 0;
    const isPresent = (id: string) => partial[id] != null;
    // recomputeRepo derives adoption/rigor by calling axisScore with the present predicate.
    expect(r.adoption).toBe(axisScore("adoption", scoreFor as never, "org", isPresent as never));
    expect(r.rigor).toBe(axisScore("rigor", scoreFor as never, "org", isPresent as never));
  });

  it("postureFor on the partial repo is 'ai-native' (overall = 80, both axes ≥ 50)", () => {
    const r = recomputeRepo(partial, "org");
    // adoption=80 (≥50) and rigor=80 (≥50) → both axes at/above POSTURE_THRESHOLD → best bucket.
    expect(postureFor(r.adoption, r.rigor).id).toBe("ai-native");
    // Sanity: the headline overall of this very same repo is firmly L4-Integrated territory.
    expect(r.overall).toBeGreaterThanOrEqual(65);
  });

  it("simulateFleet buckets the partial repo into the (correct) 'ai-native' posture in before/after", () => {
    const partialRepo: RepoDims = { fullName: "o/partial", name: "partial", archetype: "org", dims: partial };
    const proj = simulateFleet([partialRepo], { dimId: "D2", target: 100 }, ["o/partial"]);
    // Renormalized over present dims, both axes are ≥50 before (80/80) and after (D2→100 → rigor
    // round((100*0.15)/0.15)=100), so the repo stays correctly bucketed in "ai-native".
    expect(proj.before.postureCounts).toEqual({ "ai-native": 1 });
    expect(proj.after.postureCounts).toEqual({ "ai-native": 1 });
  });

  it("CONTROL: an all-dims-present repo at 80 — axis and overall AGREE, posture is 'ai-native'", () => {
    // The case existing tests already cover, asserted explicitly as the cross-check: when every
    // dimension is present, the renormalized overall and axes coincide (renormalization is a no-op),
    // and posture lands in the correct band — identical before and after the partial-scan fix.
    const r = recomputeRepo(flatRepo("o/full", 80).dims, "org");
    expect(r.overall).toBe(80);
    expect(r.adoption).toBe(80);
    expect(r.rigor).toBe(80);
    expect(postureFor(r.adoption, r.rigor).id).toBe("ai-native");
  });
});

/**
 * DIRECTION + EXACT MAGNITUDE of the simulator's movement (Finding #5: replace the lower-bound-only
 * `promotions >= 0` / `after.avgOverall >= before.avgOverall` assertions, which pass for a regression
 * that zeroes promotions or flattens the lift, with hand-derived CONSTANTS).
 *
 * All math below is hand-computed under the "org" lens (D2 weight = 0.15, all 9 dims present, so a
 * flat repo's overall = its flat score) and pinned exactly:
 *
 *   flatRepo(40): raising D2 40→100  ⇒ overall = round(40·0.85 + 100·0.15) = round(49) = 49  (Δ +9)
 *   flatRepo(80): raising D2 80→100  ⇒ overall = round(80·0.85 + 100·0.15) = round(83) = 83  (Δ +3)
 *   flatRepo(40): raising D2 40→70   ⇒ overall = round(40·0.85 +  70·0.15) = round(44) = 44  (Δ +4)
 *   flatRepo(40): LOWERING D2 40→0   ⇒ overall = round(40·0.85 +   0·0.15) = round(34) = 34  (Δ −6)
 */
describe("simulateFleet / recomputeRepo — direction + EXACT magnitude (not just >= 0)", () => {
  const repos = [flatRepo("o/a", 40), flatRepo("o/b", 40), flatRepo("o/c", 80)];

  it("RAISE: a fix that lifts D2 yields a POSITIVE overall delta of the EXACT pinned magnitude", () => {
    // Raise D2→100 across all three. Every repo is below 100 on D2, so every repo moves.
    const proj = simulateFleet(repos, { dimId: "D2", target: 100 }, ["o/a", "o/b", "o/c"]);

    // affected: pinned to the exact count (all 3 below target), not ">= 0".
    expect(proj.affected).toBe(3);

    // Per-repo overall + delta — exact constants, and each delta is strictly POSITIVE.
    const a = proj.repos.find((r) => r.fullName === "o/a")!;
    const b = proj.repos.find((r) => r.fullName === "o/b")!;
    const c = proj.repos.find((r) => r.fullName === "o/c")!;
    expect(a.overallBefore).toBe(40);
    expect(a.overallAfter).toBe(49);
    expect(a.delta).toBe(9); // direction (+) and magnitude (exactly 9)
    expect(b.delta).toBe(9);
    expect(c.overallBefore).toBe(80);
    expect(c.overallAfter).toBe(83);
    expect(c.delta).toBe(3); // c already high on D2 → smaller, but still exactly +3

    // Fleet avg lift: before = avg(40,40,80) = 53; after = avg(49,49,83) = 60 → delta EXACTLY +7.
    expect(proj.before.avgOverall).toBe(53);
    expect(proj.after.avgOverall).toBe(60);
    expect(proj.after.avgOverall - proj.before.avgOverall).toBe(7); // pinned, not ">= before"

    // Promotions: o/a 40(L2)→49(L3) and o/b 40(L2)→49(L3) cross up; o/c stays L4 → EXACTLY 2.
    expect(proj.promotions).toBe(2); // pinned, not ">= 0"
  });

  it("RAISE (smaller target): D2→70 leaves the high repo untouched — exact lift and zero promotions", () => {
    // o/c is at 80 on D2 (above 70) so it does NOT move; o/a and o/b (40) each gain exactly +4.
    const proj = simulateFleet(repos, { dimId: "D2", target: 70 }, ["o/a", "o/b", "o/c"]);
    expect(proj.affected).toBe(2); // only the two below-target repos

    const a = proj.repos.find((r) => r.fullName === "o/a")!;
    const c = proj.repos.find((r) => r.fullName === "o/c")!;
    expect(a.delta).toBe(4); // 40 → round(40·0.85 + 70·0.15) = 44
    expect(c.delta).toBe(0); // untouched (already above target)

    // before avg = 53; after = avg(44,44,80) = 56 → delta EXACTLY +3.
    expect(proj.after.avgOverall - proj.before.avgOverall).toBe(3);
    // No repo crosses a band here (44 is still L2, 80 still L4) → promotions is EXACTLY 0, not just >= 0.
    expect(proj.promotions).toBe(0);
  });

  it("LOWER: a fix that drops a dimension yields a NEGATIVE overall delta of the EXACT magnitude", () => {
    // simulateFleet only ever RAISES, so the lowering direction is pinned on recomputeRepo directly:
    // a flat-40 repo's overall is 40; dropping D2 to 0 must move overall DOWN to exactly 34 (Δ −6).
    const base = recomputeRepo(flatRepo("o/x", 40).dims, "org");
    const lowered = recomputeRepo({ ...flatRepo("o/x", 40).dims, D2: 0 }, "org");
    expect(base.overall).toBe(40);
    expect(lowered.overall).toBe(34);
    const delta = lowered.overall - base.overall;
    expect(delta).toBeLessThan(0); // direction: negative
    expect(delta).toBe(-6); // magnitude: exactly −6 (mirror of the +9 raise's shape)
  });
});
