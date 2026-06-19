import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LEVEL_HEX,
  LEVEL_GLYPH,
  scoreHex,
  scoreGlyph,
  freshness,
  timeAgo,
} from "@/lib/ui";
import { levelForScore, LEVELS } from "@/lib/maturity/model";
import { LEVEL_BANDS, BAND_EDGES } from "@/components/report/chartScale";

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

// LEVEL_BANDS / BAND_EDGES (chartScale.ts) hardcode the maturity strata as a SEPARATE copy of the
// rubric's level boundaries (LEVELS in model.ts). DimLine's shaded background bands read from this
// copy while the line's color reads from scoreHex -> levelForScore -> LEVELS. If someone retunes a
// LEVELS band but not this ramp (or vice-versa), the shaded band says "L4 starts at 60" while the
// point color still flips at 65 — the chart visually contradicts itself and nothing fails today.
// These tests DERIVE the expected band edges *from* LEVELS so the moment the rubric and the chart
// ramp drift apart, a test breaks — the bands are the rubric's by construction, not by coincidence.
describe("chart-band ramp (LEVEL_BANDS / BAND_EDGES) equals the rubric (LEVELS) — no silent drift", () => {
  // The sorted, unique boundary set the rubric implies: every level's lower edge, plus the top cap.
  // For LEVELS bands [0,24]/[25,44]/[45,64]/[65,84]/[85,100] this is [0,25,45,65,85,100].
  const rubricEdges = Array.from(
    new Set([...LEVELS.map((l) => l.band[0]), 100]),
  ).sort((a, b) => a - b);

  it("BAND_EDGES is exactly the sorted unique level boundaries derived from LEVELS", () => {
    expect([...BAND_EDGES]).toEqual(rubricEdges);
  });

  it("each LEVEL_BANDS[i].min is a rubric level's lower band edge (top→bottom = L5→L1)", () => {
    // LEVEL_BANDS is ordered high→low; LEVELS is ordered low→high. Reversed LEVELS lower-edges
    // must line up one-for-one with the band mins, so a chart band can't claim a stratum the
    // rubric doesn't define at that exact cut.
    const expectedMinsTopDown = LEVELS.map((l) => l.band[0]).reverse(); // [85,65,45,25,0]
    expect(LEVEL_BANDS.map((b) => b.min)).toEqual(expectedMinsTopDown);
  });

  it("there are exactly as many shaded bands as rubric levels", () => {
    expect(LEVEL_BANDS.length).toBe(LEVELS.length);
  });

  it("every band min sits at the rubric cut where the line color flips into that level", () => {
    // The load-bearing consistency contract: at each band's lower edge, the point color
    // (scoreHex -> levelForScore) must already be in the level that band is shading. A drift
    // where the band starts at 60 but the color still flips at 65 fails right here.
    for (const band of LEVEL_BANDS) {
      const levelAtMin = levelForScore(band.min);
      // band.min is the inclusive lower edge of exactly one rubric level.
      expect(levelAtMin.band[0]).toBe(band.min);
    }
  });

  it("the interior band edges are the right-side of each rubric cut (25/45/65/85)", () => {
    // Excluding the 0 floor and 100 cap, the interior edges are precisely the L2..L5 starts —
    // i.e. the off-by-one-sensitive handoffs locked in the scoreHex band-edge tests above.
    const interior = rubricEdges.filter((e) => e !== 0 && e !== 100);
    expect(interior).toEqual([25, 45, 65, 85]);
    // And every interior edge is the first score of a new level (color flips here).
    for (const e of interior) {
      expect(levelForScore(e).band[0]).toBe(e);
      expect(scoreHex(e)).not.toBe(scoreHex(e - 1));
    }
  });
});

// -----------------------------------------------------------------------------
// freshness / timeAgo — relative time formatting (finding score-charts-visuals #4)
// -----------------------------------------------------------------------------
// freshness powers the report's live "scanned 4m ago — re-test" ticker; timeAgo powers repo
// pushedAt. Both are pure date math against Date.now(), so we drive the clock deterministically
// with vi.setSystemTime — NEVER wall-clock. The invariants under test:
//   * each bucket formats at the right threshold (just now / Nm / Nh -> day buckets),
//   * a future/clock-skewed timestamp never renders a negative delta (clamped to "just now"/"today"),
//   * null / undefined / garbage input degrades to "unknown" — never NaN / "Invalid Date".

// A fixed, DST-neutral instant used as "now" for every case below. All inputs are derived as
// `NOW - offset` so the assertions are independent of the real clock.
const NOW = new Date("2026-06-15T12:00:00.000Z").getTime();
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** ISO string for an instant `ms` before the pinned NOW (negative ms => future). */
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("freshness — second/minute/hour buckets at their thresholds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('< 45s reads "just now" (incl. exact now and 44s)', () => {
    expect(freshness(ago(0))).toBe("just now");
    expect(freshness(ago(30 * SEC))).toBe("just now");
    expect(freshness(ago(44 * SEC))).toBe("just now");
  });

  it('the 45s seam crosses out of "just now" into minutes', () => {
    // secs=44 -> "just now"; secs=45 -> mins=round(45/60)=1 -> "1m ago".
    expect(freshness(ago(44 * SEC))).toBe("just now");
    expect(freshness(ago(45 * SEC))).toBe("1m ago");
  });

  it("formats whole minutes (rounded) below 60m", () => {
    expect(freshness(ago(5 * MIN))).toBe("5m ago");
    expect(freshness(ago(59 * MIN))).toBe("59m ago");
    // round(): 59m30s = 3570s -> round(59.5)=60 -> hours=round(60/60)=1 -> "1h ago".
    expect(freshness(ago(59 * MIN + 30 * SEC))).toBe("1h ago");
  });

  it("formats whole hours (rounded) below 24h", () => {
    expect(freshness(ago(2 * HOUR))).toBe("2h ago");
    expect(freshness(ago(3 * HOUR))).toBe("3h ago");
    expect(freshness(ago(23 * HOUR))).toBe("23h ago");
  });

  it("at/after 24h it falls through to timeAgo's day buckets", () => {
    // hours=round(24)=24 is NOT < 24, so freshness defers to timeAgo (days=1 -> "yesterday").
    expect(freshness(ago(24 * HOUR))).toBe("yesterday");
    expect(freshness(ago(3 * DAY))).toBe("3d ago");
  });
});

describe("freshness — future / invalid / null inputs are safe (never negative, never NaN)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a future timestamp (clock skew) clamps to "just now", never "-3m ago"', () => {
    expect(freshness(ago(-3 * MIN))).toBe("just now"); // 3 min in the FUTURE
    expect(freshness(ago(-10 * HOUR))).toBe("just now");
    expect(freshness(ago(-3 * MIN))).not.toMatch(/-/);
  });

  it('undefined / empty / garbage iso -> "unknown" (no Invalid Date)', () => {
    expect(freshness(undefined)).toBe("unknown");
    expect(freshness("")).toBe("unknown");
    expect(freshness("garbage")).toBe("unknown");
    expect(freshness("not-a-date")).toBe("unknown");
  });

  it("never emits NaN or 'Invalid Date' for any of a spread of inputs", () => {
    const inputs = [ago(0), ago(45 * SEC), ago(2 * HOUR), ago(5 * DAY), ago(-1 * HOUR), "x", ""];
    for (const i of inputs) {
      const out = freshness(i as string);
      expect(out).not.toContain("NaN");
      expect(out).not.toContain("Invalid");
    }
  });
});

describe("timeAgo — day/month/year buckets at their band edges", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('today / yesterday boundaries (days <= 0 -> "today", days === 1 -> "yesterday")', () => {
    expect(timeAgo(ago(0))).toBe("today");
    expect(timeAgo(ago(12 * HOUR))).toBe("today"); // floor(0.5)=0
    expect(timeAgo(ago(1 * DAY))).toBe("yesterday");
    expect(timeAgo(ago(1 * DAY + 12 * HOUR))).toBe("yesterday"); // floor(1.5)=1
  });

  it('days in [2,29] read "Nd ago"', () => {
    expect(timeAgo(ago(2 * DAY))).toBe("2d ago");
    expect(timeAgo(ago(29 * DAY))).toBe("29d ago");
  });

  it('the 30-day seam crosses into months', () => {
    expect(timeAgo(ago(29 * DAY))).toBe("29d ago");
    expect(timeAgo(ago(30 * DAY))).toBe("1mo ago"); // floor(30/30)=1
    expect(timeAgo(ago(364 * DAY))).toBe("12mo ago"); // floor(364/30)=12
  });

  it('the 365-day seam crosses into years', () => {
    expect(timeAgo(ago(364 * DAY))).toBe("12mo ago");
    expect(timeAgo(ago(365 * DAY))).toBe("1y ago"); // floor(365/365)=1
    expect(timeAgo(ago(800 * DAY))).toBe("2y ago"); // floor(800/365)=2
  });

  it('a future timestamp reads "today" (days <= 0), never negative', () => {
    expect(timeAgo(ago(-5 * DAY))).toBe("today");
    expect(timeAgo(ago(-5 * DAY))).not.toMatch(/-/);
  });

  it('undefined / garbage iso -> "unknown" (NaN-safe)', () => {
    expect(timeAgo(undefined)).toBe("unknown");
    expect(timeAgo("")).toBe("unknown");
    expect(timeAgo("garbage")).toBe("unknown");
  });
});
