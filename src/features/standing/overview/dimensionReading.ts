// The Overview's dimension READING model — pure, shared by the prototype variants.
//
// Two things the number alone never said:
//   1. WHERE in the SDLC a dimension sits. The nine dimensions are listed D1..D9 in rubric order,
//      which is the order they were defined in, not the order a team thinks about its pipeline.
//      Grouping them by SDLC phase lets a reader ask "is it how we AUTHOR, how we VERIFY, or how we
//      SHIP that is weak?" — the question that decides which practice to reach for.
//   2. WHAT the number means and what a click will do. "26" is a fact; "Emerging · weakest of 9 ·
//      below green in 3 of 3 repos" is a reading. And a row that is a link should say where it goes.
//
// SDLC_PHASES is a PROTOTYPE HYPOTHESIS about how the rubric maps onto a delivery pipeline. It is
// not the maturity model's own grouping (that is the adoption/rigor AXIS on each DimensionDef, which
// drives posture). If a direction wins, this mapping is what to argue about first.

import { DIMENSION_BY_ID, FOLLOW_UP_BELOW, LEVELS, levelForScore } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";
import { PRACTICES } from "@/lib/practices";
import { DIMENSION_SHORT } from "@/lib/ui";

export interface SdlcPhase {
  id: "author" | "verify" | "ship";
  /** Mono kicker label. */
  label: string;
  /** The question this phase answers about the fleet. */
  question: string;
  dims: DimensionId[];
}

export const SDLC_PHASES: SdlcPhase[] = [
  { id: "author", label: "Author with AI", question: "How much of the work is AI doing, and with what guidance?", dims: ["D1", "D4", "D8"] },
  { id: "verify", label: "Verify", question: "What catches an AI change before it lands?", dims: ["D2", "D6", "D9"] },
  { id: "ship", label: "Ship & learn", question: "How does a change reach production and stay legible?", dims: ["D3", "D7", "D5"] },
];

/** One word per LEVELS band, for a DIMENSION average (the level names are for whole repos). */
const BAND_WORD: Record<string, string> = { L1: "Weak", L2: "Emerging", L3: "Developing", L4: "Solid", L5: "Strong" };

export interface DimensionReading {
  dimId: DimensionId;
  short: string;
  name: string;
  avg: number;
  /** null when the window has no baseline. */
  delta: number | null;
  /** Band word for the average: Weak · Emerging · Developing · Solid · Strong. */
  status: string;
  /** Rank among the fleet's dimensions, 1 = weakest. */
  rank: number;
  total: number;
  /** Repos whose score on this dimension is below the green band, out of scanned repos with the dim. */
  belowGreen: { n: number; of: number };
  /** True below the green band — a follow-up is owed on this dimension somewhere in the fleet. */
  owed: boolean;
  /** The one-line reading, e.g. "weakest of 9 · below green in 3 of 3 repos · ▼4 vs 30d ago". */
  note: string;
  /** The practice a click leads to (title, id) — or null when the catalog has none. */
  practice: { id: string; label: string } | null;
}

const PRACTICE_BY_DIM = new Map(PRACTICES.map((p) => [p.dimId as string, p]));

export function statusWord(avg: number): string {
  return BAND_WORD[levelForScore(avg).id] ?? "—";
}

/** The band a score sits in, as its LEVELS index (0..4). Used to lay rows on a five-rung scale. */
export function bandIndex(score: number): number {
  const id = levelForScore(score).id;
  return Math.max(0, LEVELS.findIndex((l) => l.id === id));
}

const ordinal = (n: number) => (n === 1 ? "weakest" : n === 2 ? "2nd weakest" : n === 3 ? "3rd weakest" : `${n}th weakest`);

/**
 * Build the reading for every dimension in `dims`. Pure.
 * `rows` are the scanned repos' per-dimension scores (the heatmap's rows) — the source of "below
 * green in N of M repos"; `deltas` the cohort-matched window movement (null → no baseline).
 */
export function buildDimensionReadings(
  dims: { dimId: string; avg: number }[],
  deltas: { dimId: string; delta: number }[] | null | undefined,
  rows: { dims: { dimId: string; score: number }[] }[],
  deltaLabel?: string,
): DimensionReading[] {
  const deltaBy = new Map((deltas ?? []).map((d) => [d.dimId, d.delta]));
  const byAvg = [...dims].sort((a, b) => a.avg - b.avg);
  const rankOf = new Map(byAvg.map((d, i) => [d.dimId, i + 1]));
  const total = dims.length;

  return dims.flatMap((d) => {
    const def = DIMENSION_BY_ID[d.dimId as DimensionId];
    if (!def) return [];
    const scores = rows.flatMap((r) => r.dims.filter((x) => x.dimId === d.dimId).map((x) => x.score));
    const belowGreen = { n: scores.filter((s) => s < FOLLOW_UP_BELOW).length, of: scores.length };
    const delta = deltas ? (deltaBy.get(d.dimId) ?? 0) : null;
    const rank = rankOf.get(d.dimId) ?? total;
    const owed = d.avg < FOLLOW_UP_BELOW;

    const parts: string[] = [];
    if (total > 1 && rank <= 3 && owed) parts.push(`${ordinal(rank)} of ${total}`);
    else if (total > 1 && rank === total) parts.push(`strongest of ${total}`);
    if (belowGreen.of > 0 && belowGreen.n > 0) parts.push(`below green in ${belowGreen.n} of ${belowGreen.of} repo${belowGreen.of === 1 ? "" : "s"}`);
    else if (belowGreen.of > 0) parts.push(`green in every repo`);
    if (delta !== null && delta !== 0) parts.push(`${delta > 0 ? "▲" : "▼"}${Math.abs(delta)}${deltaLabel ? ` ${deltaLabel}` : ""}`);
    else if (delta === 0) parts.push("holding");

    const p = PRACTICE_BY_DIM.get(d.dimId);
    return [
      {
        dimId: d.dimId as DimensionId,
        short: DIMENSION_SHORT[d.dimId as DimensionId] ?? d.dimId,
        name: def.name,
        avg: d.avg,
        delta,
        status: statusWord(d.avg),
        rank,
        total,
        belowGreen,
        owed,
        note: parts.join(" · "),
        practice: p ? { id: p.id, label: p.label } : null,
      },
    ];
  });
}

/** Readings grouped into SDLC phases, in phase order; a dimension absent from the data is skipped.
 *  Each phase carries its own average (mean of member averages) so a phase can be read as a unit. */
export function groupByPhase(readings: DimensionReading[]): { phase: SdlcPhase; rows: DimensionReading[]; avg: number | null }[] {
  const by = new Map(readings.map((r) => [r.dimId, r]));
  return SDLC_PHASES.map((phase) => {
    const rows = phase.dims.flatMap((id) => (by.get(id) ? [by.get(id)!] : []));
    const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.avg, 0) / rows.length) : null;
    return { phase, rows, avg };
  }).filter((g) => g.rows.length > 0);
}
