// Deterministic fixtures for the data-viz scene — FICTION, and the scene says so on screen. Seeded
// (mulberry32) so the same volume always yields the same fleet: the jsdom test and the screenshot see
// one document, not a different example per load. No Math.random, no Date.now, no React.
//
// Two series per fictional repository: a daily overall score (0..100, `null` where nothing was
// measured that day — a gap, never a zero) and a daily scan count. The last bucket of every series is
// TODAY SO FAR (`partial`): a score averaged over fewer scans, a count that is still climbing. The
// volume knob sizes the fleet; the scene renders a window of it (`WINDOW` repos), which is the point
// of the knob — the techniques surviving 50,000 rows, not 50,000 mounted nodes.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";

/** 14 complete daily buckets + 1 partial (today so far). */
export const BUCKETS = 15;
/** How many repositories the scene mounts, whatever the volume. */
export const WINDOW = 8;

export type Bucket = { day: number; value: number | null; partial: boolean };
export type Shape = "steady" | "climbing" | "volatile" | "gap" | "new" | "sliding";
export type Repo = { id: string; name: string; shape: Shape; score: Bucket[]; scans: Bucket[] };
export type Total = { day: number; scans: number; failed: number; partial: boolean };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["alloy", "basalt", "cirrus", "delta", "ember", "fathom", "granite", "harbor"];
/** One of each shape the techniques care about: flat, volatile, a gap, a two-point newcomer. */
const SHAPES: readonly Shape[] = ["climbing", "steady", "volatile", "gap", "new", "sliding", "steady", "climbing"];

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

function scoreAt(shape: Shape, base: number, d: number, rnd: () => number): number | null {
  const noise = (amp: number) => (rnd() - 0.5) * amp;
  switch (shape) {
    case "steady":
      return clamp(base + noise(2));
    case "climbing":
      return clamp(base + d * 2.2 + noise(3));
    case "sliding":
      return clamp(base + 24 - d * 1.7 + noise(3));
    case "volatile":
      return clamp(base + noise(44));
    case "gap":
      // Days 5..8: the collector was down. Not measured — the bucket is null, never 0.
      return d >= 5 && d <= 8 ? null : clamp(base + d * 0.8 + noise(4));
    case "new":
      // Created two days ago: two observations, which is an anecdote with a slope, not a trend.
      return d < BUCKETS - 2 ? null : clamp(base + noise(6));
  }
}

/** The window of fictional repositories at this volume (the shapes reshuffle per volume). */
export function reposFor(volume: SurfaceVolume): Repo[] {
  const rnd = mulberry32(volume);
  return Array.from({ length: WINDOW }, (_, i) => {
    const shape = SHAPES[i % SHAPES.length]!;
    const base = 28 + Math.round(rnd() * 44);
    const cadence = 1 + Math.round(rnd() * 5);
    const score: Bucket[] = [];
    const scans: Bucket[] = [];
    for (let d = 0; d < BUCKETS; d++) {
      const partial = d === BUCKETS - 1;
      const v = scoreAt(shape, base, d, rnd);
      const n = v === null ? null : Math.max(0, Math.round(cadence + (rnd() - 0.5) * 3));
      // Today so far: the count is still climbing — plotted as final it paints a cliff.
      scans.push({ day: d, value: n === null ? null : partial ? Math.round(n * 0.4) : n, partial });
      score.push({ day: d, value: v, partial });
    }
    return { id: `repo-${i + 1}`, name: `${WORDS[i % WORDS.length]}-${String(i + 1).padStart(2, "0")}`, shape, score, scans };
  });
}

/** Fleet-wide daily totals the metric registry derives from — scaled by the volume, seeded by it. */
export function totalsFor(volume: SurfaceVolume): Total[] {
  const rnd = mulberry32(volume * 7 + 3);
  const perDay = Math.max(12, Math.round(volume * 0.31));
  return Array.from({ length: BUCKETS }, (_, d) => {
    const partial = d === BUCKETS - 1;
    const scans = Math.round(perDay * (0.85 + rnd() * 0.3) * (partial ? 0.4 : 1));
    const failed = Math.round(scans * (0.03 + rnd() * 0.06 + (d > 9 ? 0.03 : 0)));
    return { day: d, scans, failed, partial };
  });
}

/** Days ago → the short axis label ("14d" … "today"). */
export function dayLabel(day: number): string {
  const ago = BUCKETS - 1 - day;
  return ago === 0 ? "today" : `${ago}d`;
}
