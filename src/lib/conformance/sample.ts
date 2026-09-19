// Deterministic attribute sampling for the Conformance Pack (W2).
//
// An auditor's request is "show me the population, let me sample it, and evidence the control for
// each sampled item." The sample therefore has to satisfy two properties that pull against each
// other, and both are non-negotiable for an assurance artifact:
//
//   1. It must not be CHOSEN. A vendor that hand-picks which changes an auditor inspects has
//      produced marketing, not evidence.
//   2. It must be REPRODUCIBLE. An examiner who re-runs the pack over the same period must draw the
//      same rows, and must be able to verify that from the published seed alone.
//
// So: a seeded Fisher-Yates shuffle over a STABLE, content-derived ordering, with the seed printed
// in the pack. `Math.random()` would satisfy (1) and destroy (2); taking "the first N" would satisfy
// (2) and destroy (1) — the first N by date is a biased window, not a sample.
//
// The seed is derived from the org + period only, NOT from the population's contents. That matters:
// a content-derived seed would silently re-draw the whole sample every time a late scan added one
// row, so an auditor's already-filed sample would stop reproducing. Same org, same period, same
// seed, forever.

import { createHash } from "node:crypto";

/**
 * Standard attribute-sampling size for a moderate population, and the ceiling on any request.
 * 25 is the conventional attribute-sample count for a population in the low hundreds under a
 * moderate-assurance plan; it is a DEFAULT the pack states, not a statistical claim the product
 * makes on the auditor's behalf. They set their own; this is what we draw absent instruction.
 */
export const DEFAULT_SAMPLE_SIZE = 25;
export const MAX_SAMPLE_SIZE = 200;

/** The published seed string — human-readable, so an examiner can retype it. */
export function sampleSeed(orgSlug: string, from: string, to: string): string {
  return `${orgSlug}:${from}:${to}`;
}

/** 32-bit unsigned seed from the seed string, via sha256 so trivially-similar strings diverge. */
function seedInt(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0);
}

/**
 * mulberry32 — a small, exactly-specified PRNG. The algorithm is named in the pack so the draw can
 * be reproduced by a third party in any language, which a `Math.random()` shuffle can never be.
 */
export function mulberry32(a: number): () => number {
  let t = a >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw `size` items from `population` deterministically under `seed`.
 *
 * Fisher-Yates over a COPY, taking the first `size` after the shuffle — every item has an equal
 * probability of selection, and the result is a pure function of (population order, seed, size).
 * A population at or below the sample size is returned whole, in its original order: "we inspected
 * all of it" is a stronger statement than a shuffled subset, and an auditor should see it as such.
 */
export function drawSample<T>(population: readonly T[], size: number, seed: string): T[] {
  if (size <= 0) return [];
  if (population.length <= size) return [...population];
  const rng = mulberry32(seedInt(seed));
  const arr = [...population];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr.slice(0, size);
}

/** Clamp a requested sample size into the supported range. Non-numeric / absent → the default. */
export function resolveSampleSize(requested: unknown): number {
  const n = typeof requested === "string" ? Number(requested) : typeof requested === "number" ? requested : NaN;
  if (!Number.isFinite(n)) return DEFAULT_SAMPLE_SIZE;
  return Math.max(1, Math.min(MAX_SAMPLE_SIZE, Math.floor(n)));
}
