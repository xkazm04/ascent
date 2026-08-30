// Pure derivation for the "Cheapest points" variant — the tech lead's worklist. The unit is not a
// dimension's fleet average but the TRADE: bringing one dimension up to the green floor
// (FOLLOW_UP_BELOW) in every repo where it is below buys the fleet this many overall points, and
// touches that many repos. Ranked by fleet points, so the top row is the sprint's first ticket.
//
// Lift is ESTIMATED at the org lens weights (ARCHETYPE_WEIGHTS.org): a repo's real overall uses its
// own archetype lens, which the Overview does not carry. The footnote says so on the surface.

import { ARCHETYPE_WEIGHTS, DIMENSION_BY_ID, FOLLOW_UP_BELOW, levelForScore } from "@/lib/maturity/model";
import { PRACTICES } from "@/lib/practices";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionId, MaturityLevel } from "@/lib/types";
import type { HeatRow } from "./RepoDimensionHeatmap";

export interface CheapestRepo {
  name: string;
  fullName: string;
  score: number;
}

export interface CheapestRow {
  dimId: DimensionId;
  short: string;
  name: string;
  practice: { id: string; label: string } | null;
  /** Repos below the green floor on this dimension, weakest first. */
  repos: CheapestRepo[];
  /** Scored repos carrying the dimension — the "of". */
  of: number;
  /** Fleet overall points gained if every repo below reaches the floor (one decimal). */
  lift: number;
  /** lift / repos touched (one decimal). */
  perRepo: number;
  /** The dimension's own period movement; null without a baseline. */
  delta: number | null;
}

export interface CheapestPoints {
  rows: CheapestRow[];
  /** Sum of every row's lift. */
  total: number;
  scored: number;
  /** Where the fleet lands if every row is landed; null when the current average is unknown. */
  landed: { avg: number; level: MaturityLevel } | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const PRACTICE_BY_DIM = new Map(PRACTICES.map((p) => [p.dimId as string, p]));

export function buildCheapestPoints(
  heatmapRows: HeatRow[],
  dimDeltas: { dimId: string; delta: number }[] | null,
  currentAvg: number | null,
): CheapestPoints {
  const scored = heatmapRows.length;
  const deltaBy = new Map((dimDeltas ?? []).map((d) => [d.dimId, d.delta]));
  const rows: CheapestRow[] = [];
  for (const dimId of Object.keys(DIMENSION_BY_ID) as DimensionId[]) {
    const weight = ARCHETYPE_WEIGHTS.org[dimId] ?? 0;
    let of = 0;
    let gap = 0;
    const repos: CheapestRepo[] = [];
    for (const r of heatmapRows) {
      const s = r.dims.find((d) => d.dimId === dimId)?.score;
      if (s === undefined) continue;
      of += 1;
      if (s < FOLLOW_UP_BELOW) {
        gap += FOLLOW_UP_BELOW - s;
        repos.push({ name: r.name, fullName: r.fullName, score: s });
      }
    }
    if (repos.length === 0 || scored === 0) continue;
    repos.sort((a, b) => a.score - b.score);
    const lift = round1((weight * gap) / scored);
    const p = PRACTICE_BY_DIM.get(dimId);
    rows.push({
      dimId,
      short: DIMENSION_SHORT[dimId],
      name: DIMENSION_BY_ID[dimId].name,
      practice: p ? { id: p.id, label: p.label } : null,
      repos,
      of,
      lift,
      perRepo: round1(lift / repos.length),
      delta: dimDeltas ? (deltaBy.get(dimId) ?? 0) : null,
    });
  }
  rows.sort((a, b) => b.lift - a.lift || a.repos.length - b.repos.length);
  const total = round1(rows.reduce((s, r) => s + r.lift, 0));
  const landedAvg = currentAvg === null ? null : Math.min(100, Math.round(currentAvg + total));
  return {
    rows,
    total,
    scored,
    landed: landedAvg === null ? null : { avg: landedAvg, level: levelForScore(landedAvg) },
  };
}
