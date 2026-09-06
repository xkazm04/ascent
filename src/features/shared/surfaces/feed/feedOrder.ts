// The feed's order and its derivations — pure, no React. ONE comparator (the vocabulary's single
// authority): timestamp of the chosen key descending, then the authority's seq descending, three-way so
// equality falls through to the tiebreaker. Every rank site in the scene imports `compareDesc`; the
// timestamp-only comparator exists only so the chronology region can show what a partial order does.
// Also here: the (ts, seq) tuple the cursor and the read-position anchor share, relative/absolute
// time and day buckets from ONE helper on ONE clock (the scene's UTC clock), and the cluster
// derivation — a view over the atomic rows, recomputed at every render, never stored.

import { NEVER_CLUSTER, type Occurrence } from "./fixtures";

export type OrderKey = "event" | "arrival";
export type Tuple = { ts: number; seq: number };

export const tsOf = (o: Occurrence, key: OrderKey): number => (key === "event" ? o.eventAt : o.arrivedAt);
export const tupleOf = (o: Occurrence, key: OrderKey): Tuple => ({ ts: tsOf(o, key), seq: o.seq });

/** THE comparator. Copied nowhere: the store, the merge, the page and the anchor all import it. */
export const compareDesc =
  (key: OrderKey) =>
  (a: Occurrence, b: Occurrence): number =>
    tsOf(b, key) - tsOf(a, key) || b.seq - a.seq;

/** The defective comparator: ties fall to input iteration order under a stable sort. Demo only. */
export const timestampOnly =
  (key: OrderKey) =>
  (a: Occurrence, b: Occurrence): number =>
    tsOf(b, key) - tsOf(a, key);

export const isNewer = (t: Tuple, than: Tuple): boolean => t.ts > than.ts || (t.ts === than.ts && t.seq > than.seq);
export const newerThan = (o: Occurrence, anchor: Tuple, key: OrderKey): boolean => isNewer(tupleOf(o, key), anchor);

/** Positions at which two renderings of the same rows disagree — the observable defect of a partial order. */
export function swapsBetween(a: readonly Occurrence[], b: readonly Occurrence[]): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i].id !== b[i].id) n++;
  return n;
}

/** Seeded Fisher–Yates: "delivery order" for the refetch demo. */
export function shuffled<T>(rows: readonly T[], rnd: () => number): T[] {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- time display: one clock (the scene's UTC clock), one helper for bucket AND label ---------------

const DAY = 86_400_000;
const dayIndex = (ts: number): number => Math.floor(ts / DAY);

export function relative(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const absolute = (ts: number): string => new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC";

/** The day bucket, computed from the SAME expression the order uses and in the same (UTC) zone as its label. */
export function dayBucket(ts: number, now: number): string {
  const d = dayIndex(now) - dayIndex(ts);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  return new Date(ts).toISOString().slice(0, 10);
}

// --- clustering: a derivation over consecutive, related, windowed rows ------------------------------

export type ClusterRow = { type: "cluster"; id: string; relation: string; members: Occurrence[]; warn: number; newest: number; oldest: number };
export type FeedRow = { type: "row"; o: Occurrence } | ClusterRow;

export type ClusterOpts = { on: boolean; windowMs: number; cap: number };

/** The relation key, declared per kind: sync rows co-cluster by actor; the singular kinds never do. */
const relationOf = (o: Occurrence): string | null => (NEVER_CLUSTER.includes(o.kind) || o.kind !== "sync" ? null : `${o.actor}:sync`);

/**
 * Group a newest-first run into feed rows. A cluster is consecutive rows sharing a relation key, each
 * within `windowMs` of the previous member, at most `cap` members. Its identity is the relation plus
 * its OLDEST member's seq (stable as members join at the head); its position is its newest member.
 */
export function clusterRows(sorted: readonly Occurrence[], key: "event" | "arrival", opts: ClusterOpts): FeedRow[] {
  if (!opts.on) return sorted.map((o) => ({ type: "row", o }));
  const out: FeedRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    const head = sorted[i];
    const rel = relationOf(head);
    if (!rel) {
      out.push({ type: "row", o: head });
      i++;
      continue;
    }
    const members = [head];
    let j = i + 1;
    while (j < sorted.length && members.length < opts.cap && relationOf(sorted[j]) === rel && tsOf(members[members.length - 1], key) - tsOf(sorted[j], key) <= opts.windowMs) {
      members.push(sorted[j]);
      j++;
    }
    if (members.length === 1) out.push({ type: "row", o: head });
    else {
      const oldest = members[members.length - 1];
      out.push({ type: "cluster", id: `${rel}:${oldest.seq}`, relation: rel, members, warn: members.filter((m) => m.warn).length, newest: tsOf(head, key), oldest: tsOf(oldest, key) });
    }
    i = j;
  }
  return out;
}

export const rowKey = (r: FeedRow): string => (r.type === "row" ? r.o.id : r.id);
export const rowTs = (r: FeedRow, key: OrderKey): number => (r.type === "row" ? tsOf(r.o, key) : r.newest);
