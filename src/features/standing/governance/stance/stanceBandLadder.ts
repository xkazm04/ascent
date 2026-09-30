// Map a published stance's band readings onto the kit ladder. Measured bands are reached.
// The tightest measured band is current. A declared review with no repo in it is open.
// A tier the stance takes no position on is not measured, even when repos sit there.
import type { LadderState } from "@/components/kit";
import type { AutonomyTierId } from "@/lib/types";
import { TIER_META } from "./stanceShared";
import { TIER_ORDER, bandState } from "./perimeterLadder";

export interface BandReading {
  tier: AutonomyTierId;
  /** The stance declares a review requirement for this tier. */
  declared: boolean;
  repos: number;
}

export function bandLadderState(declared: boolean, repos: number, frontier: boolean): LadderState {
  const state = bandState(declared, repos);
  if (state === "not-judged") return "unmeasured";
  if (state === "declared") return "open";
  return frontier ? "current" : "reached";
}

/** The tightest tier that is both declared and occupied. Null when nothing has been read. */
export function tightestMeasured(rows: readonly BandReading[]): AutonomyTierId | null {
  for (const tier of [...TIER_ORDER].reverse()) {
    const row = rows.find((r) => r.tier === tier);
    if (row && bandState(row.declared, row.repos) === "measured") return tier;
  }
  return null;
}

export function stanceBandSteps(rows: readonly BandReading[]) {
  const frontier = tightestMeasured(rows);
  const byTier = new Map(rows.map((r) => [r.tier, r]));
  return TIER_ORDER.map((tier) => {
    const row = byTier.get(tier);
    const declared = row?.declared ?? false;
    const repos = row?.repos ?? 0;
    const state = bandLadderState(declared, repos, frontier === tier);
    const detail =
      state === "unmeasured" ? "Not judged" : state === "open" ? "Declared only" : `${repos} repo${repos === 1 ? "" : "s"}`;
    return { key: tier, label: `${tier}, ${TIER_META[tier].name}`, state, detail };
  });
}
