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

/** Compact named-stack chips for a passport: frameworks, persistence engines, integration vendors,
 *  and observability presence — the "first sight" comparison row. Bounded. */
export function passportStackChips(pp: AppPassport, max = 8): string[] {
  const chips: string[] = [];
  for (const f of pp.stack.frameworks) chips.push(f);
  for (const p of pp.stack.persistence) if (p.engine) chips.push(p.engine);
  for (const i of pp.stack.integrations) chips.push(i.name);
  return [...new Set(chips)].slice(0, max);
}
