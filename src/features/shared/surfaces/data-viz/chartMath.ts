// Projection and encoding helpers for the scene's dependency-free SVG charts. Pure functions.
//
// The structural rule of scale-and-axis-design lives in one signature: `project()` DEMANDS a domain.
// There is no way to draw a line through the sanctioned door without saying what its floor and ceiling
// are — the sample-anchored floor (the one defect) has to be spelled out as a policy to exist at all.
// Series colour is a function of the series' IDENTITY (its id), never of its index: a re-sort cannot
// move a colour, and the palette has a stated capacity beyond which it aliases.

import type { Bucket } from "./fixtures";

export type Domain = readonly [number, number];
/** Scores are a share of a whole: the reference frame is the whole, so the shared scale is 0..100. */
export const SCORE_DOMAIN: Domain = [0, 100];

export type Box = { w: number; h: number; pad: number };
export type Pt = { x: number; y: number; value: number; day: number; partial: boolean };

/** Bucket → pixel, clamped to the domain (a NaN or out-of-domain value cannot break the path). */
export function project(series: readonly Bucket[], domain: Domain, box: Box): (Pt | null)[] {
  const [lo, hi] = domain;
  const span = Math.max(hi - lo, 1e-9);
  const n = Math.max(series.length - 1, 1);
  return series.map((b, i) => {
    if (b.value === null || !Number.isFinite(b.value)) return null;
    const c = Math.max(lo, Math.min(hi, b.value));
    return {
      x: box.pad + (i / n) * (box.w - box.pad * 2),
      y: box.h - box.pad - ((c - lo) / span) * (box.h - box.pad * 2),
      value: b.value,
      day: b.day,
      partial: b.partial,
    };
  });
}

/** Consecutive measured runs. A gap (null) BREAKS the line: unmeasured is neither zero nor a bridge. */
export function runs(points: readonly (Pt | null)[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of points) {
    if (p) cur.push(p);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

export const pathOf = (run: readonly Pt[]): string =>
  run.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

/** The unmeasured stretches, as [firstIndex, lastIndex] pairs, for the gap shading. */
export function gaps(series: readonly Bucket[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  series.forEach((b, i) => {
    if (b.value === null && start < 0) start = i;
    if (b.value !== null && start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, series.length - 1]);
  return out;
}

export type ScalePolicy = "shared" | "auto" | "sample-floor";
export const SCALE_POLICIES: readonly { id: ScalePolicy; label: string; why: string }[] = [
  { id: "shared", label: "shared 0–100", why: "Siblings will be compared, so the set shares one declared domain." },
  { id: "auto", label: "auto (zero floor)", why: "Ceiling follows the data, floor stays at zero: a declared policy, still comparable in magnitude." },
  { id: "sample-floor", label: "sample floor (defect)", why: "Floor = the sample's own minimum. Every panel fills its box; amplitude now carries no information." },
];

const complete = (s: readonly Bucket[]): number[] => s.filter((b) => b.value !== null && !b.partial).map((b) => b.value as number);

/** The next round ceiling in the score's unit — ticks land on 25s, never on 47.4. */
export const niceCeil = (v: number): number => Math.min(100, Math.max(25, Math.ceil(v / 25) * 25));

/** The domain a policy assigns to one series; the partial bucket never sets a ceiling. */
export function domainFor(policy: ScalePolicy, series: readonly Bucket[]): Domain {
  const vals = complete(series);
  if (policy === "shared" || vals.length === 0) return SCORE_DOMAIN;
  if (policy === "auto") return [0, niceCeil(Math.max(...vals))];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return [lo, hi === lo ? lo + 1 : hi];
}

/** 3–5 ticks on round numbers; the defect's domain gets its raw bounds, which is what exposes it. */
export function ticksFor(domain: Domain): number[] {
  const [lo, hi] = domain;
  if (lo === 0 && hi % 25 === 0) return Array.from({ length: hi / 25 + 1 }, (_, i) => i * 25);
  return [lo, hi];
}

/** Colour bound to identity: the number minted in the id, not the row's position. */
// The product's categorical identity palette. A verbatim copy of `STACK_COLORS` in
// src/features/standing/tech-stacks/stackViz.ts: feature groups may not import each other (AGENTS.md),
// and the palette has no home under @/lib/ui yet - that absence is the deviation the encoding region
// names. When it moves to the lib, import it from there and delete this copy.
const STACK_COLORS = ["#3987e5", "#199e70", "#9085e9", "#d55181", "#1596b0"] as const;
export const PALETTE_CAPACITY = STACK_COLORS.length;
export function seriesColor(id: string): string {
  const n = Number(id.replace(/\D/g, "")) || 0;
  return STACK_COLORS[(n - 1 + PALETTE_CAPACITY) % PALETTE_CAPACITY]!;
}

/** True when two ids alias under the modulo wrap — the collision the capacity rule exists for. */
export const aliases = (a: string, b: string): boolean => a !== b && seriesColor(a) === seriesColor(b);

/** Measured, complete observations in a series — the count a shape claim must clear. */
export const measuredCount = (s: readonly Bucket[]): number => complete(s).length;
/** Below this many observations a line is an anecdote with a slope. */
export const MIN_POINTS_FOR_SHAPE = 3;

/** Latest complete value (the number a glyph rides beside), or null when nothing is measured. */
export function latest(s: readonly Bucket[]): number | null {
  const v = complete(s);
  return v.length ? v[v.length - 1]! : null;
}

/** Delta of the latest complete value against the first measured one (null below the floor). */
export function shapeDelta(s: readonly Bucket[]): number | null {
  const v = complete(s);
  return v.length < MIN_POINTS_FOR_SHAPE ? null : v[v.length - 1]! - v[0]!;
}
