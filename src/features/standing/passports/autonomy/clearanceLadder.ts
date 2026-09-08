// The clearance register drawn as nested permission bands instead of described in a paragraph.
//
// The demoted sentence was: "Every scanned repo holds a clearance, issued on five observable
// conditions. The clearance says what may be delegated today, and the countersignature line says
// exactly what would raise it." A clearance IS a containment — T3 may do everything T0 may, and
// more — so `BandLadder` draws the nesting (docs/ORG-UX-REDESIGN.md §2.2) and the per-repo card keeps
// the countersignature line, which is a per-repo fact and was never a fleet one.
//
// Pure: no React. Kit types are `import type`, so nothing client-side is pulled in.

import type { LadderBand, LadderEdge, VizState } from "@/components/org/viz";
import { TIERS, TIER_META, tierHex, type AutonomyTier, type RepoAutonomy } from "./autonomyModel";

/** A clearance resting on a deterministic placeholder scan was never graded by a model. */
const isPlaceholder = (r: RepoAutonomy): boolean => r.engine === "mock";

/**
 * The bands, outermost (most permissive) first — the order `BandLadder` documents.
 *
 * A band whose repos were ALL scored by the placeholder engine is `not-judged`: it is hatched and its
 * count is suppressed, because a clearance issued off a deterministic floor is not a measurement of
 * that repo. A band with none, or only some, stays `measured` and the placeholder population is
 * carried on the edge instead, where it can be counted without pretending the whole band is fiction.
 */
export function clearanceBands(repos: RepoAutonomy[]): LadderBand[] {
  return [...TIERS].reverse().map((t: AutonomyTier) => {
    const held = repos.filter((r) => r.tier === t);
    const state: VizState = held.length > 0 && held.every(isPlaceholder) ? "not-judged" : "measured";
    return {
      id: `t${t}`,
      label: `${TIER_META[t].code} · ${TIER_META[t].label}`,
      state,
      count: held.length,
      color: tierHex(t),
    };
  });
}

/**
 * What crosses the perimeter with no measurement behind it: clearances issued off a placeholder
 * scan. `ClearanceCard` has always whispered this in its footer ("· placeholder scan"); at fleet
 * level it was invisible, so a register of floors read exactly like a register of gradings.
 */
export function clearanceEdge(repos: RepoAutonomy[]): LadderEdge | null {
  const count = repos.filter(isPlaceholder).length;
  if (count === 0) return null;
  return { label: "issued on a placeholder scan", count, state: "not-judged" };
}

/** The states these bands (plus the edge) actually use, in kit order — the `Legend` contract. */
export function clearanceStates(bands: LadderBand[], edge: LadderEdge | null): VizState[] {
  const present = new Set<VizState>(bands.map((b) => b.state));
  if (edge?.state) present.add(edge.state);
  return (["measured", "not-judged"] as VizState[]).filter((s) => present.has(s));
}
