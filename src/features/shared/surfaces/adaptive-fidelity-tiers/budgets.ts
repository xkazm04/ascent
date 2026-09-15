// The tier VOCABULARY (one authority) and the per-effect budget tables that read it. No React.
//
// The tier is one small ordinal — full / reduced / floor — and it means nothing on its own. What it
// means is a fact about each effect, so each effect declares its own table beside its own
// implementation, typed against `Tier` so a fourth rung breaks every table at once. The rows are the
// effect's PARAMETERS (a count, a period, a layer depth), never an on/off switch for the whole effect,
// and the floor row may be a reduction rather than an absence.

export const TIERS = ["full", "reduced", "floor"] as const;
export type Tier = (typeof TIERS)[number];

/** Ordinal for "lower of" comparisons: floor < reduced < full. */
export const TIER_RANK: Record<Tier, number> = { floor: 0, reduced: 1, full: 2 };
export const lowerTier = (a: Tier, b: Tier): Tier => (TIER_RANK[a] <= TIER_RANK[b] ? a : b);
export const stepDown = (t: Tier): Tier => (t === "full" ? "reduced" : "floor");
export const stepUp = (t: Tier): Tier => (t === "floor" ? "reduced" : "full");

/**
 * A review aid, not a computation: the vocabulary publishes a rough degradation ratio so an outlier
 * table (a reduced row at 90 % of full, or at 5 %) is visible against it. Every real number stays in
 * the effect's own table.
 */
export const DEGRADATION_GUIDE: Record<Tier, string> = {
  full: "100 %",
  reduced: "½ – ⅔ of full",
  floor: "≈ ⅓, or a designed static fallback",
};

/** Which effects owe a table at all — graded by cost class, so the answer is looked up, not estimated. */
export type Obligation = "must" | "should" | "exempt";
export const OBLIGATIONS: readonly { cls: string; obligation: Obligation; why: string }[] = [
  { cls: "drives its own clock — a per-frame loop, a canvas, a simulation", obligation: "must", why: "its cost is unbounded in a parameter it chose" },
  { cls: "forces compositing — a large blur, a full-surface gradient, a blend, a parallax layer", obligation: "should", why: "real but fixed cost; often an honest two-row table" },
  { cls: "a small composited transition on one element", obligation: "exempt", why: "costs less than the read that would consult the tier" },
];

// ── Effect 1: the strata field (drives its own clock → MUST carry a table) ─────────────────────────
// Load-bearing row: `lines`. The drift loop's length is the line count; the period is nearly free.
export type StrataRow = { lines: number; driftMs: number; glowPass: boolean };
export const STRATA: Record<Tier, StrataRow> = {
  full: { lines: 12, driftMs: 9_000, glowPass: true },
  reduced: { lines: 7, driftMs: 14_000, glowPass: false },
  // The floor is a REDUCTION: three static lines keep the panel's altimeter texture. Zero would delete
  // the only structure the header has, which is a second design nobody drew.
  floor: { lines: 3, driftMs: 0, glowPass: false },
};
export const STRATA_LOAD_BEARING = "lines — the per-frame loop is exactly this long";

// ── Effect 2: the panel wash (forces compositing → SHOULD carry a table) ───────────────────────────
// Load-bearing row: `layers`. Each layer is a full-surface radial gradient; the opacity ceiling is free.
export type WashRow = { layers: number; opacityCeiling: number };
export const WASH: Record<Tier, WashRow> = {
  full: { layers: 2, opacityCeiling: 0.35 },
  reduced: { layers: 1, opacityCeiling: 0.22 },
  floor: { layers: 1, opacityCeiling: 0.12 },
};
export const WASH_LOAD_BEARING = "layers — each one is a full-surface gradient the compositor must blend";

/** The tier an explicit preference implies, without a measurement. */
export const PREFERENCE_TIER: Record<"reduced-motion" | "full" | "floor", Tier> = {
  "reduced-motion": "floor",
  full: "full",
  floor: "floor",
};
