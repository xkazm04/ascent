"use client";

// The scene's one store plus its derivations, memoised per render: the sorted client (through the
// ACTIVE comparator, so the chronology demo and the list agree), the clustered rows (a view, recomputed
// here and stored nowhere), the unseen counts — each one a comparison against an anchor under the
// active filter, never a maintained integer — and the retention horizon the list's edge renders.

import { useMemo, useReducer } from "react";
import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import type { Occurrence } from "./fixtures";
import { clusterRows, newerThan, tupleOf, type FeedRow } from "./feedOrder";
import { horizonAt } from "./feedRetention";
import { comparatorOf, initial, reduce, type Action, type Filter, type State } from "./feedStore";

export const CLUSTER_WINDOW_MS = 10 * 60_000;
export const CLUSTER_CAP = 50;
/** Badge magnitude is capped in DISPLAY only; the derivation is exact. */
export const BADGE_CAP = 99;

export type Derived = {
  sorted: Occurrence[];
  rows: FeedRow[];
  /** Occurrences newer than the STORED anchor under the filter, held buffer included: the badge. */
  unseen: number;
  /** Occurrences newer than the FROZEN entry anchor: the "since you were away" delta. */
  sinceEntry: number;
  horizonTs: number;
  oldestKeptTs: number | null;
  matches: (o: Occurrence) => boolean;
};

export const predicateOf =
  (filter: Filter) =>
  (o: Occurrence): boolean =>
    filter === "all" || o.kind === "security";

export const badgeLabel = (n: number): string => (n > BADGE_CAP ? `${BADGE_CAP}+` : String(n));

export function useFeed(volume: SurfaceVolume): { s: State; d: Derived; dispatch: (a: Action) => void } {
  const [s, dispatch] = useReducer(reduce, volume, initial);
  const d = useMemo<Derived>(() => {
    const matches = predicateOf(s.filter);
    const sorted = s.client.filter(matches).sort(comparatorOf(s)); // the filter narrows WHICH rows, never how they order
    const rows = clusterRows(sorted, s.key, { on: s.clusterOn, windowMs: CLUSTER_WINDOW_MS, cap: CLUSTER_CAP });
    const all = [...s.client, ...s.held];
    const unseen = all.filter((o) => matches(o) && newerThan(o, s.stored, s.key)).length;
    const sinceEntry = all.filter((o) => matches(o) && newerThan(o, s.entry, s.key)).length;
    let oldest: number | null = null;
    for (const o of s.server) oldest = oldest === null ? tupleOf(o, s.key).ts : Math.min(oldest, tupleOf(o, s.key).ts);
    return { sorted, rows, unseen, sinceEntry, horizonTs: horizonAt(s.retention, s.now), oldestKeptTs: oldest, matches };
  }, [s]);
  return { s, d, dispatch };
}
