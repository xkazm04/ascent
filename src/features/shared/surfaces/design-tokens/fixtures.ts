// Deterministic fixtures (mulberry32). The same volume always yields the same fictional codebase and
// the same chart series, so the jsdom test and a screenshot are reproducible. No Math.random, no
// Date.now, no React. Nothing here is an Ascent org or an Ascent file.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";

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

export type SourceLine = { file: string; classes: string };

const DIRS = ["billing", "fleet", "report", "settings", "onboarding", "alerts"];
const NAMES = ["Panel", "Row", "Card", "Header", "Toast", "Meter", "Ledger", "Badge"];

/** Class strings that speak the vocabulary. */
const CLEAN = [
  "rounded-card border-token bg-surface type-body text-foreground",
  "type-caption text-foreground-muted duration-base ease-enter",
  "bg-accent text-on-accent rounded-interactive duration-instant",
  "space-card border-token bg-surface-raised type-figure",
];
/** Class strings carrying a raw value that has a semantic equivalent. */
const RAW = [
  "rounded-card bg-surface text-[11px] text-foreground-muted",
  "border-[#1e293b] type-body text-foreground",
  "rounded-[7px] bg-accent text-on-accent",
  "type-caption transition duration-[187ms]",
  "bg-[#0f172a] type-body text-foreground",
];
/** A loud, countable inline suppression naming the rule and its reason. */
export const SUPPRESSION = "/* token-lint: allow (brand asset, fixed by the partner) */";

/** `volume` fictional source lines; about one in nine carries a raw value, one in sixty of those is suppressed. */
export function codebaseFor(volume: SurfaceVolume): SourceLine[] {
  const rnd = mulberry32(volume);
  const out: SourceLine[] = [];
  for (let i = 0; i < volume; i++) {
    const r = rnd();
    const file = `src/${DIRS[i % DIRS.length]}/${NAMES[Math.floor(rnd() * NAMES.length)]}-${String(i + 1).padStart(3, "0")}.tsx`;
    let classes = CLEAN[i % CLEAN.length]!; // modulo index into a non-empty literal list
    if (r < 0.11) {
      classes = RAW[Math.floor(rnd() * RAW.length)]!; // rnd() < 1, so the index is in range
      if (rnd() < 0.06) classes = `${SUPPRESSION} ${classes}`;
    }
    out.push({ file, classes });
  }
  return out;
}

/** Twelve scan scores for the preview's chart, 40..95. */
export function chartSeries(seed = 11): number[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: 12 }, () => Math.round(40 + rnd() * 55));
}

export const PREVIEW_REPO = { name: "kestrel-04", level: "L3", score: 72, meta: "14 open follow-ups, last scan 2h ago" };
