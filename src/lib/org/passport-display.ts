// Shared, pure presentational helpers for the App Readiness Passport (P2/P3) — band labels/colors and
// compact stack chips, so the per-repo card and the fleet table/scatter render the same vocabulary.

import type { AppPassport, ProductionBand } from "@/lib/types";

export const BAND_LABEL: Record<ProductionBand, string> = {
  prototype: "Prototype",
  internal: "Internal",
  beta: "Beta",
  production: "Production",
  hardened: "Hardened",
};

export const BAND_COLOR: Record<ProductionBand, string> = {
  prototype: "#dc2626",
  internal: "#d97706",
  beta: "#3b9eff",
  production: "#16a34a",
  hardened: "#84cc16",
};

export const bandLabel = (b: string): string => BAND_LABEL[b as ProductionBand] ?? b;
export const bandColor = (b: string): string => BAND_COLOR[b as ProductionBand] ?? "#94a3b8";

// ── Readiness cohorts (P3 portfolio) ────────────────────────────────────────────────────────────
// The automation×production plane splits at 65 (the L4 / production-band boundary) into four
// quadrant cohorts; "no-obs" is the orthogonal zero-observability slice. One vocabulary for the
// scatter's quadrants, the filter chips, and the headline counts, so they can never disagree.

/** Quadrant cutoff on both axes — the L4 / production-band boundary. */
export const PASSPORT_SPLIT = 65;

export type PassportCohort = "ready" | "gap" | "hostile" | "early";

export const COHORT_META: Record<PassportCohort, { label: string; color: string; blurb: string }> = {
  ready: { label: "Ready to ship", color: "#84cc16", blurb: "automation ≥65 · production ≥65" },
  gap: { label: "Automatable, not prod-ready", color: "#d97706", blurb: "automation ≥65 · production <65" },
  hostile: { label: "Prod-grade, agent-hostile", color: "#3b9eff", blurb: "automation <65 · production ≥65" },
  early: { label: "Early on both axes", color: "#94a3b8", blurb: "automation <65 · production <65" },
};

export const COHORT_ORDER: PassportCohort[] = ["ready", "gap", "hostile", "early"];

/** Which quadrant cohort a passport's two scores fall into. */
export function cohortOf(autoScore: number, prodScore: number): PassportCohort {
  if (autoScore >= PASSPORT_SPLIT) return prodScore >= PASSPORT_SPLIT ? "ready" : "gap";
  return prodScore >= PASSPORT_SPLIT ? "hostile" : "early";
}

/** Compact named-stack chips for a passport: frameworks, persistence engines, integration vendors,
 *  and observability presence — the "first sight" comparison row. Bounded. */
export function passportStackChips(pp: AppPassport, max = 8): string[] {
  const chips: string[] = [];
  for (const f of pp.stack.frameworks) chips.push(f);
  for (const p of pp.stack.persistence) if (p.engine) chips.push(p.engine);
  for (const i of pp.stack.integrations) chips.push(i.name);
  return [...new Set(chips)].slice(0, max);
}
