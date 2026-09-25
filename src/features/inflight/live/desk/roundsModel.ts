// THE ROUNDS, folded for the desk — the chronicle (one row per run) joined to its lanes (one row per
// lane), oldest first, split into chapters at quiet gaps. Pure: the flight log, the last-rounds table,
// the figures, the arm league and search all read this one fold.
//
// Honesty, as code: a round's reported $ is the sum of the lanes that RECORDED a cost, and the count of
// those that did not travels beside it (`costUnknown`) — unknown is never folded in as $0. A null
// verdict counts as `unknown`, never `skipped`. Closes are the chronicle's `verifiedCloses`: the
// rescan's adjudicated set, never an agent's claim.

import type { LoopRunChronicleEntry, RoundLane } from "./deskTypes";
import { toMs, verdictKey, type VerdictKey } from "./deskFormat";

/** A quiet gap this long between two rounds starts a new chapter of the flight log. */
export const CHAPTER_GAP_MS = 5 * 3_600_000;

export type VerdictCounts = Record<VerdictKey, number>;
export const zeroVerdicts = (): VerdictCounts => ({ verified: 0, rejected: 0, baseline: 0, skipped: 0, unknown: 0 });

export interface DeskRound {
  id: string;
  seq: number | null;
  /** "#62", or the start date for a row the backfill never numbered. */
  label: string;
  startMs: number | null;
  endMs: number | null;
  durMs: number | null;
  phase: string;
  repos: string[];
  maxCycles: number;
  error: string | null;
  lanes: RoundLane[];
  /** False when the lane read failed — marks and verdict counts are then unknown, not zero. */
  lanesKnown: boolean;
  closes: number;
  costMicros: number | null;
  costKnown: number;
  costUnknown: number;
  verdicts: VerdictCounts;
  errors: number;
  lift: number | null;
  landed: number;
  gapBeforeMs: number;
  chapter: number;
}

export interface Chapter {
  no: number;
  from: number;
  to: number;
}

export interface RoundTotals {
  runs: number;
  lanes: number;
  closes: number;
  costMicros: number;
  costKnown: number;
  costUnknown: number;
  verdicts: VerdictCounts;
  errors: number;
  landed: number;
  firstMs: number | null;
  lastMs: number | null;
}

export interface RoundsFold {
  rounds: DeskRound[];
  chapters: Chapter[];
  totals: RoundTotals;
  byId: Map<string, DeskRound>;
}

const laneOrder = (a: RoundLane, b: RoundLane): number =>
  (toMs(a.startedAt) ?? 0) - (toMs(b.startedAt) ?? 0) || a.cycle - b.cycle || a.repo.localeCompare(b.repo);

function foldRound(r: LoopRunChronicleEntry, lanes: RoundLane[] | null): Omit<DeskRound, "gapBeforeMs" | "chapter"> {
  const mine = lanes ? lanes.filter((l) => l.runId === r.id).sort(laneOrder) : [];
  const verdicts = zeroVerdicts();
  let cost = 0;
  let costKnown = 0;
  let costUnknown = 0;
  let errors = 0;
  for (const l of mine) {
    verdicts[verdictKey(l.verdict)]++;
    if (l.costMicros == null) costUnknown++;
    else {
      cost += l.costMicros;
      costKnown++;
    }
    if (l.errored) errors++;
  }
  const startMs = toMs(r.startedAt);
  const endMs = toMs(r.endedAt);
  // With no lane grain, the chronicle's own sum is the only reading (null there = none reported).
  const costMicros = lanes ? (costKnown ? cost : null) : (r.costMicros ?? null);
  return {
    id: r.id,
    seq: r.seq,
    label: r.seq != null ? `#${r.seq}` : (r.startedAt ?? "").slice(0, 10),
    startMs,
    endMs,
    durMs: startMs != null && endMs != null ? endMs - startMs : null,
    phase: r.phase,
    repos: r.repos ?? [],
    maxCycles: r.maxCycles,
    error: r.error,
    lanes: mine,
    lanesKnown: lanes != null,
    closes: r.verifiedCloses,
    costMicros,
    costKnown,
    costUnknown,
    verdicts,
    errors,
    lift: r.lift ?? null,
    landed: r.landedAt?.length ?? 0,
  };
}

/** Rounds arrive newest first; the fold is oldest first (the flight log reads left to right in time). */
export function foldRounds(rounds: readonly LoopRunChronicleEntry[], lanes: RoundLane[] | null): RoundsFold {
  const ordered = [...rounds].sort(
    (a, b) => (toMs(a.startedAt) ?? 0) - (toMs(b.startedAt) ?? 0) || (a.seq ?? 0) - (b.seq ?? 0),
  );
  const chapters: Chapter[] = [];
  const out: DeskRound[] = [];
  ordered.forEach((r, i) => {
    const base = foldRound(r, lanes);
    const prev = out[i - 1];
    const gap = prev ? (base.startMs ?? 0) - (prev.endMs ?? prev.startMs ?? 0) : 0;
    if (!prev || gap > CHAPTER_GAP_MS) chapters.push({ no: chapters.length + 1, from: i, to: i });
    else chapters[chapters.length - 1]!.to = i;
    out.push({ ...base, gapBeforeMs: gap, chapter: chapters.length });
  });

  const totals: RoundTotals = {
    runs: out.length,
    lanes: 0,
    closes: 0,
    costMicros: 0,
    costKnown: 0,
    costUnknown: 0,
    verdicts: zeroVerdicts(),
    errors: 0,
    landed: 0,
    firstMs: out[0]?.startMs ?? null,
    lastMs: out.length ? (out[out.length - 1]!.endMs ?? out[out.length - 1]!.startMs) : null,
  };
  for (const r of out) {
    totals.lanes += r.lanes.length;
    totals.closes += r.closes;
    totals.costMicros += r.costMicros ?? 0;
    totals.costKnown += r.costKnown;
    totals.costUnknown += r.costUnknown;
    totals.errors += r.errors;
    totals.landed += r.landed;
    for (const k of Object.keys(r.verdicts) as VerdictKey[]) totals.verdicts[k] += r.verdicts[k];
  }
  return { rounds: out, chapters, totals, byId: new Map(out.map((r) => [r.id, r])) };
}

/** "3 verified · 1 no baseline" — the verdict mix of a round, in the order a reader weighs it. */
export function verdictMix(v: VerdictCounts): string {
  const order: [VerdictKey, string][] = [
    ["verified", "verified"],
    ["rejected", "rejected"],
    ["baseline", "no baseline"],
    ["unknown", "unknown"],
  ];
  return order
    .filter(([k]) => v[k])
    .map(([k, w]) => `${v[k]} ${w}`)
    .join(" · ");
}
