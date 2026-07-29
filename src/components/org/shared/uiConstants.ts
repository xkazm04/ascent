// Pure, server-safe constants + helpers shared by the org dashboard's presentational primitives
// (ui.tsx). Split out so ui.tsx stays under the 200-LOC cap — `.ts` is deliberately uncapped
// (docs/ORG-TABS-REFACTOR.md). Re-exported from ui.tsx so every existing import site is unchanged.

import { DIMENSION_SHORT } from "@/lib/ui";
import { POSTURE_META } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";

// Derived from the canonical, ordered posture taxonomy (maturity/model) so a new/renamed posture
// flows through automatically — mirrors how DIMS is derived from DIMENSION_SHORT. Previously these
// were hand-maintained duplicates that would silently drop any posture added in postureFor().
export const POSTURE_LABEL: Record<string, string> = Object.fromEntries(
  POSTURE_META.map((p) => [p.id, p.label]),
);
export const POSTURE_ORDER = POSTURE_META.map((p) => p.id);

/**
 * POSTURE_LABEL lookup with a safe fallback for an unknown/legacy posture id (a new or renamed posture
 * the map doesn't cover yet). Renders a humanized form of the raw id ("ai-native" → "Ai Native")
 * rather than a blank cell or the raw slug, so a fleet table can never show an empty/garbled posture.
 */
export function postureLabel(posture: string | null | undefined): string {
  if (!posture) return "—";
  return POSTURE_LABEL[posture] ?? posture.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Heatmap / dimension-average columns, derived from the canonical dimension map (the same source
// that supplies the column labels) so adding a dimension — e.g. D9 Security — widens every fleet
// view automatically. Was frozen at D1–D8, which silently dropped D9 Security from the heatmap.
export const DIMS = Object.keys(DIMENSION_SHORT) as DimensionId[];

/**
 * The summary-tile ledger frame — ONE bordered panel whose cells are separated by 1px hairline rules
 * (the HairlineGrid signature), replacing the old four-floating-cards grid: less chrome, tighter
 * vertical rhythm, and the shared frame keeps a row of stats reading as one instrument. Tiles must be
 * the direct children (they paint the opaque bg-ink cell the hairline bed shows through around).
 * Compose with a column rhythm: TILE_GRID is the canonical 4-across; other rhythms append their own
 * grid-cols (e.g. BacklogSummary's 6-across).
 */
export const TILE_LEDGER = "grid gap-px overflow-hidden rounded-2xl border border-divider bg-divider";

/** Canonical summary-tile grid — one column rhythm for every tab's top tiles. */
export const TILE_GRID = `${TILE_LEDGER} sm:grid-cols-2 lg:grid-cols-4`;

export const fmtHours = (h: number | null) =>
  h == null ? "—" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`;
