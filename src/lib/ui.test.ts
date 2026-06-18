import { describe, it, expect } from "vitest";
import {
  LEVEL_HEX,
  LEVEL_GLYPH,
  scoreHex,
  scoreGlyph,
} from "@/lib/ui";
import { levelForScore } from "@/lib/maturity/model";

// scoreHex / scoreGlyph route a 0..100 score through the rubric (score -> level -> color/glyph).
// The contract the source comments promise: the displayed color/glyph is ALWAYS the rubric
// level's, so the chart ramp can never silently desync from levelForScore. These tests lock
// that contract at every band edge and across the whole 0..100 range, plus the clamp.

describe("scoreHex / scoreGlyph — exact color & glyph per band edge", () => {
  // Hard-coded expectations (independent of levelForScore) so a change to EITHER the
  // rubric bands OR the hex/glyph maps trips a test.
  it("L1 band edges -> red / empty circle", () => {
    expect(scoreHex(0)).toBe("#ef4444");
    expect(scoreHex(24)).toBe("#ef4444");
    expect(scoreGlyph(0)).toBe("○");
    expect(scoreGlyph(24)).toBe("○");
  });

  it("L2 band edges (25..44) -> orange / one-quarter", () => {
    expect(scoreHex(25)).toBe("#f97316");
    expect(scoreHex(44)).toBe("#f97316");
    expect(scoreGlyph(25)).toBe("◔");
    expect(scoreGlyph(44)).toBe("◔");
  });

  it("L3 band edges (45..64) -> yellow / half", () => {
    expect(scoreHex(45)).toBe("#eab308");
    expect(scoreHex(64)).toBe("#eab308");
    expect(scoreGlyph(45)).toBe("◑");
    expect(scoreGlyph(64)).toBe("◑");
  });

  it("L4 band edges (65..84) -> lime / three-quarter", () => {
    expect(scoreHex(65)).toBe("#84cc16");
    expect(scoreHex(84)).toBe("#84cc16");
    expect(scoreGlyph(65)).toBe("◕");
    expect(scoreGlyph(84)).toBe("◕");
  });

  it("L5 band edges (85..100) -> green / full", () => {
    expect(scoreHex(85)).toBe("#22c55e");
    expect(scoreHex(100)).toBe("#22c55e");
    expect(scoreGlyph(85)).toBe("●");
    expect(scoreGlyph(100)).toBe("●");
  });

  // The off-by-one trap, mirrored from levelForScore: color must flip on the right side of each cut.
  it("color flips on the correct side of every cut", () => {
    expect(scoreHex(24)).not.toBe(scoreHex(25)); // L1->L2
    expect(scoreHex(44)).not.toBe(scoreHex(45)); // L2->L3
    expect(scoreHex(64)).not.toBe(scoreHex(65)); // L3->L4
    expect(scoreHex(84)).not.toBe(scoreHex(85)); // L4->L5
  });
});

describe("scoreHex / scoreGlyph — locked in lockstep with levelForScore for all 0..100", () => {
  it("scoreHex(s) === LEVEL_HEX[levelForScore(s).id] for every integer score", () => {
    for (let s = 0; s <= 100; s++) {
      expect(scoreHex(s)).toBe(LEVEL_HEX[levelForScore(s).id]);
    }
  });

  it("scoreGlyph(s) === LEVEL_GLYPH[levelForScore(s).id] for every integer score", () => {
    for (let s = 0; s <= 100; s++) {
      expect(scoreGlyph(s)).toBe(LEVEL_GLYPH[levelForScore(s).id]);
    }
  });
});

describe("scoreHex / scoreGlyph — out-of-range inputs are clamped, never NaN/undefined", () => {
  it("below 0 clamps to L1 color/glyph", () => {
    expect(scoreHex(-1)).toBe("#ef4444");
    expect(scoreHex(-500)).toBe("#ef4444");
    expect(scoreGlyph(-1)).toBe("○");
  });

  it("above 100 clamps to L5 color/glyph", () => {
    expect(scoreHex(101)).toBe("#22c55e");
    expect(scoreHex(9999)).toBe("#22c55e");
    expect(scoreGlyph(101)).toBe("●");
  });

  it("the rounding seam carries through to the color (24.4 red, 24.5 orange)", () => {
    expect(scoreHex(24.4)).toBe("#ef4444");
    expect(scoreHex(24.5)).toBe("#f97316");
  });

  it("always returns a defined, non-empty hex string and a known glyph", () => {
    const glyphs = new Set(Object.values(LEVEL_GLYPH));
    for (const s of [-1000, -1, 0, 50, 100, 101, 1000, 24.5, 44.5]) {
      const hex = scoreHex(s);
      expect(hex).toBeDefined();
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(glyphs.has(scoreGlyph(s))).toBe(true);
    }
  });
});
