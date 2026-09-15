// Deterministic fixtures for the fidelity scene: a seeded FRAME TRACE, not this page's own frames.
// The arithmetic the probe runs on the samples is the real technique; the samples are fiction, and
// the scene says so on screen. Seeded (mulberry32): the same window index at the same tier always
// yields the same 60 intervals, so the jsdom test and a screenshot are reproducible. No Math.random,
// no Date.now, no React.
//
// `volume` (the frame's fixture knob) is accepted by the scene and ignored here: this subject is
// feedback-and-style, not data-display — a frame trace does not get longer at 50,000 rows.

import type { Tier } from "./budgets";

export type WindowKind = "good" | "neutral" | "bad" | "catastrophic";

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

/**
 * The feedback loop made real: the workload the next window measures depends on the tier that is
 * rendering it. These are the fixture's "measured cost step between adjacent tiers" — the number the
 * dead band must be wider than (see probe.ts UPGRADE_MS). Fiction, labelled as such in the scene.
 */
export const TIER_COST_MS: Record<Tier, number> = { full: 6, reduced: 2, floor: 0 };

/** Base interval ranges per window kind, before the tier's cost is added (ms). */
const BASE: Record<WindowKind, { min: number; spread: number }> = {
  good: { min: 9, spread: 4 }, // p90 ≈ 12.6 → ≤ 18.6 at full: under UPGRADE_MS at every tier
  neutral: { min: 17, spread: 8 }, // p90 ≈ 24 → 30 at full: inside the dead band at every tier
  bad: { min: 30, spread: 12 }, // p90 ≈ 41: over DOWNGRADE_MS at every tier
  catastrophic: { min: 80, spread: 60 }, // p90 ≈ 134: several multiples of the budget
};

/** 60 frame intervals for one window of `kind`, at the workload `tier` implies. */
export function windowSamples(kind: WindowKind, index: number, tier: Tier, count = 60): number[] {
  const rnd = mulberry32(1_000 * index + 17);
  const { min, spread } = BASE[kind];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round((min + rnd() * spread + TIER_COST_MS[tier]) * 10) / 10);
  return out;
}

/**
 * The scripted session the play control walks, cycling. Read against the transition rules: three
 * good windows climb from the declared default to full (an ARRIVAL); one bad window drops a rung at
 * once; good-neutral-good-neutral never accumulates a run because the dead band resets the counter;
 * three consecutive goods climb again; the run of unchanged windows then settles the probe.
 */
export const TRACE: readonly WindowKind[] = [
  "good", "good", "good", "bad", "good", "neutral", "good", "neutral", "good", "good", "good", "good", "good", "good",
];

/** What a declaration would have said about this (fictional) device — shown so the scene can refuse it. */
export const DECLARED_DEVICE = {
  userAgent: "Mobile Safari",
  cores: 4,
  memoryGb: 4,
  guess: "lean" as const,
};
