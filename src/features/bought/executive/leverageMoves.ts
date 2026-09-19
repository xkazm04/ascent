// The widest shared fleet gaps, as bar geometry. Pure, so the one rule that matters here is
// unit-testable: a gap with no engine-true projection NEVER gets a bar.
//
// THE INVARIANT. `OrgRec.projectedPoints` is null when no affected repository has persisted
// dimension rows — the engine could not project a gain. That row's state is `missing`: a void, drawn
// as a dashed rule and printing no numeral (`rendersValue` is false for it). The old header said "the
// engine-true maturity each repo stands to gain" and the card then quietly omitted the phrase when it
// could not compute one; a reader scanning six cards had no way to tell an omitted projection from a
// small one. The void says it.
//
// THE SCALE. A move's bar length is `perRepo × repoCount` — the maturity points on the table across
// the whole fleet if that one gap closes. That single length is reach AND impact at once, on one
// shared scale, which is what makes the ranking VISIBLE rather than asserted by a numbered list. The
// per-repo gain is recoverable from the same bar: it is one segment, and the segment dividers are
// drawn per affected repository.

import type { VizState } from "@/components/org/viz";
import type { OrgRec } from "@/lib/db";
import { dimShort } from "@/lib/ui";

/** (D) The demoted ranking basis — the WhyChip beside the header, not a sentence above the panel. */
export const LEVERAGE_BASIS_HINT =
  "Ordered by leverage: how many repositories share the gap × its impact × the dimension's weight in the maturity model. Bar length is the maturity points on the table across the whole fleet — the per-repo gain times the repos that share it.";

/** (D) Why a row can have no bar at all. */
export const LEVERAGE_VOID_HINT =
  "No affected repository has persisted dimension rows, so the engine cannot project a gain. An absence, never a zero — and never an invented number.";

/** (D) What the accent tick on a bar marks. */
export const LEVERAGE_RUNG_HINT =
  "Where the affected repositories that would cross into the next maturity level end. Left of the tick is a level change, not just points.";

/** (D) The restraint, said once on demand instead of permanently above the panel. */
export const LEVERAGE_ORDER_HINT =
  "Somewhere to look next, not an order. Nothing here is assigned, ranked by urgency, or owed — the fleet simply shares these gaps most widely.";

/** How many per-repo segment dividers are still legible inside one bar. Above this the bar is solid
 *  and the reach is carried by the readout and the accessible table instead of by sub-pixel rules. */
export const SEGMENT_CAP = 24;

export type LeverageBar = {
  id: string;
  /** The gap itself, as the scan named it. */
  title: string;
  dimId: string;
  /** Pre-formatted short dimension name — no function prop crosses into the view. */
  dimLabel: string;
  impact: string;
  repoCount: number;
  repos: string[];
  liftsRepos: number;
  /** Maturity points ONE affected repo gains if the gap closes. Null → nothing was projected. */
  perRepo: number | null;
  /** `perRepo × repoCount`. Null when unprojected — the bar is a void, not a zero. */
  fleetPoints: number | null;
  state: VizState;
  leverage: number;
  /** Pre-formatted "shared by 4 repos: a, b, c +2". */
  reach: string;
};

function reachOf(rec: OrgRec): string {
  const shown = rec.repos.slice(0, 6).join(", ");
  const more = rec.repos.length > 6 ? ` +${rec.repos.length - 6}` : "";
  return `shared by ${rec.repoCount} repo${rec.repoCount === 1 ? "" : "s"}: ${shown}${more}`;
}

export function leverageBars(recs: OrgRec[]): LeverageBar[] {
  return recs.map((rec, i) => {
    // Guard the arithmetic, not just the null: a non-finite or negative projection is not a gain,
    // and multiplying it by a repo count would produce a bar pointing the wrong way.
    const perRepo =
      typeof rec.projectedPoints === "number" && Number.isFinite(rec.projectedPoints) && rec.projectedPoints > 0
        ? rec.projectedPoints
        : null;
    const count = Number.isFinite(rec.repoCount) && rec.repoCount > 0 ? rec.repoCount : 0;
    const fleetPoints = perRepo !== null && count > 0 ? perRepo * count : null;
    return {
      id: `${rec.dimId}-${i}`,
      title: rec.title,
      dimId: rec.dimId,
      dimLabel: dimShort(rec.dimId),
      impact: rec.impact,
      repoCount: rec.repoCount,
      repos: rec.repos,
      liftsRepos: Number.isFinite(rec.liftsRepos) && rec.liftsRepos > 0 ? Math.min(rec.liftsRepos, rec.repoCount) : 0,
      perRepo,
      fleetPoints,
      state: fleetPoints === null ? ("missing" as VizState) : ("measured" as VizState),
      leverage: rec.leverage,
      reach: reachOf(rec),
    };
  });
}

/** The domain maximum for the shared scale. 0 when nothing is projected — the view then draws only
 *  voids, which is the honest picture of a fleet whose repos predate dimension scoring. */
export function leverageMax(bars: LeverageBar[]): number {
  return bars.reduce((m, b) => (b.fleetPoints !== null && b.fleetPoints > m ? b.fleetPoints : m), 0);
}

/** Only the states actually present, in the kit's order — the Legend contract. */
export function leverageStates(bars: LeverageBar[]): VizState[] {
  const out: VizState[] = [];
  if (bars.some((b) => b.state === "measured")) out.push("measured");
  if (bars.some((b) => b.state === "missing")) out.push("missing");
  return out;
}

/** The bar's own readout. Never a numeral for a void — that is the whole point of the state. */
export function leverageReadout(b: LeverageBar): string {
  if (b.fleetPoints === null) return "—";
  return `${b.fleetPoints} pts · +${b.perRepo} × ${b.repoCount}`;
}
