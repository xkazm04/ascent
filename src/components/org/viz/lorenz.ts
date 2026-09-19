// Lorenz / concentration maths for `ConcentrationCurve`. Pure, testable, no React.
//
// Kept out of the component so the geometry and the sr-only table are demonstrably built from the
// same numbers, and so the bus-factor arithmetic can be pinned by a test without a DOM.

import { isNum } from "@/components/org/viz/vizNum";

export type LorenzPoint = { x: number; y: number };

export type Concentration = {
  /** n + 1 cumulative points from (0,0) to (1,1), least-productive first. */
  points: LorenzPoint[];
  /** Gini coefficient, 0 (perfectly even) → 1 (one contributor does everything). */
  gini: number;
  /** The point of maximum distance below the equality diagonal — the risk knee. */
  knee: LorenzPoint;
  /** How many of the LARGEST contributors it takes to cover half the total. The bus factor. */
  busFactor: number;
  /** Contributors counted (non-finite / negative values are dropped, not zeroed). */
  n: number;
  total: number;
};

/**
 * Build the Lorenz curve for a set of per-contributor magnitudes. Returns null when the set cannot
 * support a curve (fewer than two usable values, or nothing but zeros) — the caller renders a
 * labelled placeholder rather than a straight line that would read as "perfectly even".
 */
export function concentrationOf(values: number[]): Concentration | null {
  const clean = values.filter((v): v is number => isNum(v) && v >= 0).sort((a, b) => a - b);
  const n = clean.length;
  const total = clean.reduce((a, b) => a + b, 0);
  if (n < 2 || total <= 0) return null;

  const points: LorenzPoint[] = [{ x: 0, y: 0 }];
  let run = 0;
  for (let i = 0; i < n; i++) {
    run += clean[i] ?? 0;
    points.push({ x: (i + 1) / n, y: run / total });
  }

  // G = (2 * Σ i·x_i) / (n · Σ x_i) − (n + 1)/n over an ascending sort.
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * (clean[i] ?? 0);
  const gini = Math.max(0, Math.min(1, (2 * weighted) / (n * total) - (n + 1) / n));

  // The knee: the largest vertical drop below the diagonal. It is where "a few people carry the
  // rest" becomes visible, which is the reading the bus-factor sentence used to assert in prose.
  let knee = points[0] as LorenzPoint;
  let best = -1;
  for (const p of points) {
    const gap = p.x - p.y;
    if (gap > best) {
      best = gap;
      knee = p;
    }
  }

  // Bus factor: how many of the biggest contributors it takes to reach half the total.
  let fromTop = 0;
  let busFactor = n;
  for (let i = n - 1; i >= 0; i--) {
    fromTop += clean[i] ?? 0;
    if (fromTop >= total / 2) {
      busFactor = n - i;
      break;
    }
  }

  return { points, gini, knee, busFactor, n, total };
}
