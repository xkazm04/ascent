// Quantile maths for the Contributors tab's distribution strips. Pure, no React, no DB.
//
// The tab used to state its distributions in prose ("Quartiles across everyone sharing", "High
// top-share or bus-factor 1 = key-person risk") over sorted tables. `Distribution` from the /org viz
// kit draws them instead, and it needs a five-number summary. That summary is computed HERE so the
// picture and the sr-only table it generates are demonstrably the same numbers, and so the
// arithmetic can be pinned by a test without a DOM.
//
// Nothing in this file can see a login: it takes magnitudes and returns magnitudes, which is the
// same privacy guarantee `computeOrgResilience` gets from being pure.

export type FiveNumber = {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
};

/**
 * The five-number summary of `values`, or null when the set cannot support one.
 *
 * Null — never a zero-width box — for fewer than two usable values: a "distribution" over one
 * observation is a point drawn as a spread, which is exactly the class of claim this redesign exists
 * to stop. Non-finite entries are DROPPED rather than coerced to 0 (§2.4: a missing measurement is
 * never a zero), so `n` is the count that actually backed the box, not the length of the input.
 */
export function quantiles(values: readonly number[]): (FiveNumber & { n: number }) | null {
  const clean = values.filter((v): v is number => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length < 2) return null;
  return {
    min: clean[0] as number,
    q1: quantileAt(clean, 0.25),
    median: quantileAt(clean, 0.5),
    q3: quantileAt(clean, 0.75),
    max: clean[clean.length - 1] as number,
    n: clean.length,
  };
}

/**
 * Linear interpolation between order statistics (the R-7 / spreadsheet PERCENTILE default), so a
 * four-person org gets a median between the two middle values rather than an arbitrary pick.
 */
function quantileAt(sorted: readonly number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] as number;
  if (lo === hi) return a;
  const b = sorted[hi] as number;
  return a + (b - a) * (idx - lo);
}
