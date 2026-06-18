import { describe, it, expect } from "vitest";
import { LEVELS, levelForScore } from "@/lib/maturity/model";

// The score -> level keystone. Every ring/radar/waterfall/heatmap/badge AND the CI
// gate route through levelForScore, so a one-line band or off-by-one drift mis-colors
// and mis-grades every repo. These tests pin the EXACT band boundaries, the clamp, and
// the Math.round rounding seam so any future retune of LEVELS fails loudly here.
//
// Real thresholds (model.ts): L1 [0,24] L2 [25,44] L3 [45,64] L4 [65,84] L5 [85,100].
// levelForScore = LEVELS.find(s >= band[0] && s <= band[1]) over s = clamp(Math.round(score)).

describe("levelForScore — band boundaries", () => {
  it("maps representative mid-band scores to the right level", () => {
    expect(levelForScore(0).id).toBe("L1");
    expect(levelForScore(12).id).toBe("L1");
    expect(levelForScore(35).id).toBe("L2");
    expect(levelForScore(55).id).toBe("L3");
    expect(levelForScore(75).id).toBe("L4");
    expect(levelForScore(95).id).toBe("L5");
    expect(levelForScore(100).id).toBe("L5");
  });

  // Both sides of every cut — the off-by-one trap. The upper edge of one band and the
  // lower edge of the next must land on opposite levels.
  it("L1/L2 handoff at 24 vs 25", () => {
    expect(levelForScore(24).id).toBe("L1");
    expect(levelForScore(25).id).toBe("L2");
  });

  it("L2/L3 handoff at 44 vs 45", () => {
    expect(levelForScore(44).id).toBe("L2");
    expect(levelForScore(45).id).toBe("L3");
  });

  it("L3/L4 handoff at 64 vs 65", () => {
    expect(levelForScore(64).id).toBe("L3");
    expect(levelForScore(65).id).toBe("L4");
  });

  it("L4/L5 handoff at 84 vs 85", () => {
    expect(levelForScore(84).id).toBe("L4");
    expect(levelForScore(85).id).toBe("L5");
  });
});

describe("levelForScore — clamp to [0,100]", () => {
  it("clamps below 0 to L1", () => {
    expect(levelForScore(-1).id).toBe("L1");
    expect(levelForScore(-10).id).toBe("L1");
    expect(levelForScore(-1000).id).toBe("L1");
  });

  it("clamps above 100 to L5", () => {
    expect(levelForScore(101).id).toBe("L5");
    expect(levelForScore(150).id).toBe("L5");
    expect(levelForScore(99999).id).toBe("L5");
  });
});

describe("levelForScore — Math.round rounding seam", () => {
  // score is rounded BEFORE band lookup, so the seam sits at .5 (Math.round rounds .5 up).
  it("24.4 rounds down to 24 -> L1; 24.5 rounds up to 25 -> L2", () => {
    expect(levelForScore(24.4).id).toBe("L1");
    expect(levelForScore(24.5).id).toBe("L2");
  });

  it("44.5 -> 45 -> L3 and 44.49 -> 44 -> L2", () => {
    expect(levelForScore(44.49).id).toBe("L2");
    expect(levelForScore(44.5).id).toBe("L3");
  });

  it("64.5 -> 65 -> L4 and 84.5 -> 85 -> L5", () => {
    expect(levelForScore(64.5).id).toBe("L4");
    expect(levelForScore(84.5).id).toBe("L5");
  });

  it("a value just under a .5 seam stays in the lower band (84.4 -> L4)", () => {
    expect(levelForScore(84.4).id).toBe("L4");
  });
});

describe("levelForScore — never returns undefined and covers every integer 0..100", () => {
  it("returns a defined level for every integer score in range", () => {
    for (let s = 0; s <= 100; s++) {
      const lvl = levelForScore(s);
      expect(lvl).toBeDefined();
      expect(lvl.id).toMatch(/^L[1-5]$/);
      // the returned level's band must actually contain the (rounded) score
      expect(s).toBeGreaterThanOrEqual(lvl.band[0]);
      expect(s).toBeLessThanOrEqual(lvl.band[1]);
    }
  });
});

describe("LEVELS rubric shape — the bands these tests pin", () => {
  it("has 5 contiguous, gap-free, non-overlapping bands covering 0..100", () => {
    const byId = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
    expect(byId.L1.band).toEqual([0, 24]);
    expect(byId.L2.band).toEqual([25, 44]);
    expect(byId.L3.band).toEqual([45, 64]);
    expect(byId.L4.band).toEqual([65, 84]);
    expect(byId.L5.band).toEqual([85, 100]);

    // contiguity: each band's lower edge is exactly one past the previous upper edge
    const ordered = ["L1", "L2", "L3", "L4", "L5"].map((id) => byId[id]);
    expect(ordered[0].band[0]).toBe(0);
    expect(ordered[ordered.length - 1].band[1]).toBe(100);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].band[0]).toBe(ordered[i - 1].band[1] + 1);
    }
  });
});
