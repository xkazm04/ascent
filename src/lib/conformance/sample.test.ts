import { describe, expect, it } from "vitest";
import { drawSample, mulberry32, resolveSampleSize, sampleSeed, DEFAULT_SAMPLE_SIZE, MAX_SAMPLE_SIZE } from "./sample";

const pop = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("drawSample", () => {
  // THE reproducibility property. An examiner re-running the export must draw the same rows, or the
  // sample they filed cannot be re-verified — which would make the whole pack unusable as evidence.
  it("is deterministic for the same population and seed", () => {
    const a = drawSample(pop(200), 25, "acme:2026-05-01:2026-08-01");
    const b = drawSample(pop(200), 25, "acme:2026-05-01:2026-08-01");
    expect(a).toEqual(b);
  });

  it("draws a different sample under a different seed", () => {
    const a = drawSample(pop(200), 25, "acme:2026-05-01:2026-08-01");
    const b = drawSample(pop(200), 25, "acme:2026-02-01:2026-05-01");
    expect(a).not.toEqual(b);
  });

  // The anti-cherry-pick property: taking the first N by date is a biased window, not a sample. If
  // the draw ever degenerated to a prefix, a vendor would be handing auditors the oldest changes.
  it("does not return a prefix of the population", () => {
    const drawn = drawSample(pop(200), 25, "seed");
    expect(drawn).not.toEqual(pop(25));
  });

  it("returns exactly `size` distinct items from the population", () => {
    const drawn = drawSample(pop(200), 25, "seed");
    expect(drawn).toHaveLength(25);
    expect(new Set(drawn).size).toBe(25);
    for (const d of drawn) expect(d).toBeGreaterThanOrEqual(0);
  });

  // "We inspected all of it" is a stronger statement than a shuffled subset, and the examiner should
  // see the population in its natural order when that is what happened.
  it("returns a small population whole, in its original order", () => {
    expect(drawSample(pop(10), 25, "seed")).toEqual(pop(10));
    expect(drawSample(pop(25), 25, "seed")).toEqual(pop(25));
  });

  it("is empty-safe and zero-safe", () => {
    expect(drawSample([], 25, "seed")).toEqual([]);
    expect(drawSample(pop(10), 0, "seed")).toEqual([]);
    expect(drawSample(pop(10), -5, "seed")).toEqual([]);
  });

  it("never mutates the population it was given", () => {
    const original = pop(50);
    const copy = [...original];
    drawSample(original, 10, "seed");
    expect(original).toEqual(copy);
  });

  // Sanity that the shuffle actually reaches across the population rather than swapping a few
  // neighbours — a degenerate PRNG would pass every test above and still bias the draw.
  it("draws from across the whole population, not one end of it", () => {
    const drawn = drawSample(pop(500), 50, "seed");
    expect(Math.min(...drawn)).toBeLessThan(100);
    expect(Math.max(...drawn)).toBeGreaterThan(400);
  });
});

describe("mulberry32", () => {
  it("is a pure function of its seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("stays inside [0, 1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("sampleSeed", () => {
  // Derived from org + period ONLY — never the population's contents. A content-derived seed would
  // silently re-draw the entire sample every time a late scan added one row, so an auditor's
  // already-filed sample would stop reproducing.
  it("depends only on the org and the period", () => {
    expect(sampleSeed("acme", "2026-05-01", "2026-08-01")).toBe("acme:2026-05-01:2026-08-01");
  });
});

describe("resolveSampleSize", () => {
  it("defaults when absent or unparseable", () => {
    expect(resolveSampleSize(undefined)).toBe(DEFAULT_SAMPLE_SIZE);
    expect(resolveSampleSize(null)).toBe(DEFAULT_SAMPLE_SIZE);
    expect(resolveSampleSize("abc")).toBe(DEFAULT_SAMPLE_SIZE);
  });

  it("clamps into the supported range", () => {
    expect(resolveSampleSize("0")).toBe(1);
    expect(resolveSampleSize("-10")).toBe(1);
    expect(resolveSampleSize("10000")).toBe(MAX_SAMPLE_SIZE);
    expect(resolveSampleSize("40")).toBe(40);
    expect(resolveSampleSize("40.7")).toBe(40);
  });
});
