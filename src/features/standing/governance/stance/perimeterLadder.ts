// The perimeter, as geometry rather than as a paragraph (org UX redesign §2).
//
// This sentence used to sit above the stance panel, 304 characters of it:
//   "One line around the fleet: what the stance permits to cross, how deep a change may go without
//    extra review, and what stays sealed. … declared, not enforced."
// It was a picture someone had written out. The nesting IS the containment, the dashed outline IS
// "declared, not enforced", and the arrow crossing the outer edge IS "what PR attribution shows
// crossing without a declaration" — so the shaping lives here and the sentence is gone.
//
// PURE — no React, no I/O. Server-safe.

import type { LadderBand, LadderEdge, VizState } from "@/components/org/viz";
import type { AutonomyTierId } from "@/lib/types";
import type { RepoStanceCompliance } from "@/lib/org/stance";
import { TIER_HEX, TIER_META } from "./stanceShared";

/** Outermost (most permissive) first — the order the ladder insets. */
export const TIER_ORDER: readonly AutonomyTierId[] = ["T0", "T1", "T2", "T3"];

/**
 * The band's epistemic state, which is the whole argument of the redesign compressed into one
 * ternary:
 *
 *  - `measured`   — the stance declares a review requirement for this tier AND repos actually sit
 *                   in it, so the declaration has been read against observed git attribution.
 *  - `declared`   — the stance declares a requirement and no repo has been read into the band. The
 *                   perimeter exists on paper only: dashed outline, no fill. This is the encoding
 *                   that replaces "declared, not enforced".
 *  - `not-judged` — the stance takes no position for this tier. Hatched, and the kit refuses to
 *                   print a value beside it: nothing here has been judged, and an undeclared band
 *                   must never read as a passing one. The repos themselves are still listed in full
 *                   by the band sections below — the ladder is the headline, not the ledger.
 */
export function bandState(declared: boolean, repos: number): VizState {
  if (!declared) return "not-judged";
  return repos > 0 ? "measured" : "declared";
}

export function perimeterBands(
  byTier: Record<AutonomyTierId, RepoStanceCompliance[]>,
  reviewFor: ReadonlyMap<AutonomyTierId, string>,
): LadderBand[] {
  return TIER_ORDER.map((tier) => {
    const repos = byTier[tier] ?? [];
    const state = bandState(reviewFor.get(tier) != null, repos.length);
    return {
      id: tier,
      label: `${tier} · ${TIER_META[tier].name}`,
      state,
      count: repos.length,
      color: TIER_HEX[tier],
    };
  });
}

/**
 * What crosses the outer boundary with no declaration behind it.
 *
 * Null when nothing was observed crossing: the kit paints an undeclared crossing in the warn tone,
 * and drawing that arrow at zero would put a warning on a fleet that earned none.
 */
export function perimeterEdge(undeclaredTools: readonly { name: string }[]): LadderEdge | null {
  if (undeclaredTools.length === 0) return null;
  return {
    label: `undeclared tool${undeclaredTools.length === 1 ? "" : "s"} observed crossing`,
    count: undeclaredTools.length,
    state: "missing",
  };
}

/** Only the states this ladder actually draws, in the vocabulary's own order. */
export function perimeterStates(bands: readonly LadderBand[], edge: LadderEdge | null): VizState[] {
  const present: VizState[] = [];
  for (const s of ["measured", "declared", "not-judged", "missing"] as const) {
    if (bands.some((b) => b.state === s) || (edge != null && (edge.state ?? "missing") === s)) present.push(s);
  }
  return present;
}
