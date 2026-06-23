import { describe, expect, it } from "vitest";
import { CENTER, mapRepos, starLook, starPosition } from "./fleetMapStars";

// Invariant batch for the three pure layout/derivation helpers (test-mastery launch-fleet-map #3).
// These already live extracted in fleetMapStars.ts (a React-free module imported by FleetMap.tsx,
// ConstellationField.tsx, and the launch OpenGraph image) — but were untested. They are pure and
// exported, so the load-bearing invariants are pinned directly against the production module.

describe("starPosition — deterministic, in-bounds phyllotaxis placement", () => {
  it("is deterministic: the SAME (i,total,seed) yields the IDENTICAL coordinate on repeat calls", () => {
    const a = starPosition(7, 40, "org/repo");
    const b = starPosition(7, 40, "org/repo");
    expect(b).toEqual(a); // no Math.random / no per-render drift → no SSR/CSR hydration jitter
  });

  it("stays inside the 120×120 field for every index across the documented star counts", () => {
    // The field is centered at CENTER (60) with radius ~13..55, so coords land well within [0,120].
    for (const total of [1, 9, 40, 80]) {
      for (let i = 0; i < total; i++) {
        const { cx, cy } = starPosition(i, total, `seed-${total}-${i}`);
        expect(cx).toBeGreaterThanOrEqual(0);
        expect(cx).toBeLessThanOrEqual(120);
        expect(cy).toBeGreaterThanOrEqual(0);
        expect(cy).toBeLessThanOrEqual(120);
        expect(Number.isFinite(cx)).toBe(true);
        expect(Number.isFinite(cy)).toBe(true);
      }
    }
  });

  it("spreads across the canvas without collapsing to one point (no overlap collapse)", () => {
    // 80 stars (MAX_STARS) must occupy distinct positions, not stack on the center.
    const pts = Array.from({ length: 80 }, (_, i) => starPosition(i, 80, `r${i}`));
    const keys = new Set(pts.map((p) => `${p.cx.toFixed(3)},${p.cy.toFixed(3)}`));
    expect(keys.size).toBe(80); // all distinct
    // Index 0 sits ~13 off center, so even the innermost star is not pinned to the exact center.
    expect(Math.hypot(pts[0]!.cx - CENTER, pts[0]!.cy - CENTER)).toBeGreaterThan(5);
  });

  it("pins exact coordinates on a crafted seed (regression lock on the phyllotaxis math)", () => {
    // i=0: radius = 13 + sqrt(0.6/1)*42, angle = hash01('pin')*0.6 — fully determined by the seed.
    const p = starPosition(0, 1, "pin");
    expect(p.cx).toBeCloseTo(103.99388281524043, 6);
    expect(p.cy).toBeCloseTo(71.7387323698342, 6);
    const q = starPosition(3, 10, "pin");
    expect(q.cx).toBeCloseTo(74.64113646844415, 6);
    expect(q.cy).toBeCloseTo(95.28281625540109, 6);
  });
});

describe("starLook — maturity → size/color/opacity across each band", () => {
  it("returns the faint default for an unscanned (null) repo", () => {
    expect(starLook(null)).toEqual({ color: "#64748b", r: 1.1, opacity: 0.32 });
  });

  it("maps each score band to its canonical level color", () => {
    expect(starLook(10).color).toBe("#ef4444"); // L1 (0..24)   red
    expect(starLook(35).color).toBe("#f97316"); // L2 (25..44)  orange
    expect(starLook(55).color).toBe("#eab308"); // L3 (45..64)  yellow
    expect(starLook(75).color).toBe("#84cc16"); // L4 (65..84)  lime
    expect(starLook(95).color).toBe("#22c55e"); // L5 (85..100) green
  });

  it("scales radius and opacity monotonically with score, staying within the scanned bounds", () => {
    const lo = starLook(0); // t=0 → r 1.5, opacity 0.55 (band floor)
    const hi = starLook(100); // t=1 → r 3.4, opacity 1.0  (band ceiling)
    expect(lo.r).toBeCloseTo(1.5, 6);
    expect(lo.opacity).toBeCloseTo(0.55, 6);
    expect(hi.r).toBeCloseTo(3.4, 6);
    expect(hi.opacity).toBeCloseTo(1.0, 6);
    expect(starLook(50).r).toBeGreaterThan(lo.r);
    expect(starLook(50).r).toBeLessThan(hi.r);
  });

  it("clamps out-of-range scores so r/opacity never escape the [1.5,3.4]/[0.55,1.0] contract", () => {
    const over = starLook(150); // clamps to 100 → L5
    const under = starLook(-10); // clamps to 0   → L1
    expect(over).toEqual(starLook(100));
    expect(over.color).toBe("#22c55e");
    expect(under.color).toBe("#ef4444");
    for (const look of [over, under]) {
      expect(look.r).toBeGreaterThanOrEqual(1.5);
      expect(look.r).toBeLessThanOrEqual(3.4);
      expect(look.opacity).toBeGreaterThanOrEqual(0.55);
      expect(look.opacity).toBeLessThanOrEqual(1.0);
    }
  });
});

describe("mapRepos — coerce untrusted /api/app/repos JSON into stars", () => {
  it("returns [] for any non-array input instead of throwing (trust boundary)", () => {
    expect(mapRepos(null)).toEqual([]);
    expect(mapRepos(undefined)).toEqual([]);
    expect(mapRepos({})).toEqual([]);
    expect(mapRepos("nope")).toEqual([]);
    expect(mapRepos(42)).toEqual([]);
  });

  it("preserves identity + the right fields for a well-formed row", () => {
    const stars = mapRepos([
      {
        fullName: "acme/web",
        name: "web",
        private: true,
        state: { level: "L4", overall: 72, watched: true },
        dOverall: 5,
      },
    ]);
    expect(stars).toEqual([
      { fullName: "acme/web", overall: 72, level: "L4", dOverall: 5, watched: true },
    ]);
  });

  it("preserves order and identity across a multi-row list", () => {
    const stars = mapRepos([
      { fullName: "o/a", name: "a", private: false, state: { level: "L1", overall: 10 } },
      { fullName: "o/b", name: "b", private: false, state: { level: "L5", overall: 90 } },
    ]);
    expect(stars.map((s) => s.fullName)).toEqual(["o/a", "o/b"]);
    expect(stars).toHaveLength(2);
  });

  it("does not throw on a row missing state — yields null overall/level and watched:false", () => {
    const [s] = mapRepos([{ fullName: "o/x", name: "x", private: false, state: null }]);
    expect(s).toEqual({ fullName: "o/x", overall: null, level: null, dOverall: null, watched: false });
  });

  it("coerces a non-number dOverall to null", () => {
    const [s] = mapRepos([
      { fullName: "o/y", state: { level: "L2", overall: 30 }, dOverall: "lots" },
    ]);
    expect(s.dOverall).toBeNull();
  });

  it("does not throw on a garbage row lacking state entirely", () => {
    expect(() => mapRepos([{ fullName: "o/z", name: "z", private: false }])).not.toThrow();
    const [s] = mapRepos([{ fullName: "o/z", name: "z", private: false }]);
    expect(s.overall).toBeNull();
    expect(s.watched).toBe(false);
  });
});
