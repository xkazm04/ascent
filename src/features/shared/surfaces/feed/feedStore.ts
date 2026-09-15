// The feed's state machine as a pure reducer (no React): a SERVER (the system of record, reaped on
// every insert), a CLIENT (the rows the surface has been delivered, sorted at render), a HELD buffer
// (arrivals that would have inserted above a reading viewport), one ordering key, the two read-position
// anchors (frozen entry snapshot + advancing store), the retention contract, and the seam state of a
// live transport. Every rank site imports the one comparator from feedOrder.ts.

import { SCENE_NOW, advanceFor, arrivalAt, mulberry32, occurrencesFor, type Occurrence } from "./fixtures";
import { compareDesc, isNewer, shuffled, swapsBetween, timestampOnly, tupleOf, type OrderKey, type Tuple } from "./feedOrder";
import { DEFAULT_RETENTION, forfeitAtHorizon, horizonAt, pageOlder, reap, type Retention } from "./feedRetention";
import type { SurfaceVolume } from "@/lib/org/surface-catalog";

export const FIRST_PAGE = 40;
export const PAGE = 20;
/** The reader last looked ENTRY_DEPTH occurrences ago — the fixture's read-position anchor. */
export const ENTRY_DEPTH = 12;
export type Filter = "all" | "security";
export type Comparator = "tuple" | "timestamp";

export type State = {
  now: number;
  n: number;
  nextSeq: number;
  key: OrderKey;
  server: Occurrence[];
  client: Occurrence[];
  held: Occurrence[];
  atHead: boolean;
  flushes: number;
  connected: boolean;
  lastDelivered: Tuple;
  seam: null | "clean" | "missed";
  catchup: { fetched: number; dropped: number } | null;
  entry: Tuple;
  stored: Tuple;
  writes: number;
  filter: Filter;
  clusterOn: boolean;
  expanded: readonly string[];
  retention: Retention;
  reapedTotal: number;
  forfeited: number;
  lastPage: { rows: number; truncated: boolean } | null;
  comparator: Comparator;
  swaps: number;
  refetches: number;
  pending: Occurrence | null;
};

export type Action =
  | { type: "arrive"; count: number; late?: boolean; sync?: boolean }
  | { type: "key"; key: OrderKey }
  | { type: "scroll"; atHead: boolean }
  | { type: "jump" }
  | { type: "disconnect" }
  | { type: "reconnect"; ok: boolean }
  | { type: "refetch" }
  | { type: "comparator"; comparator: Comparator }
  | { type: "markRead" }
  | { type: "filter"; filter: Filter }
  | { type: "cluster"; on: boolean }
  | { type: "expand"; id: string }
  | { type: "horizon"; days: number }
  | { type: "pageOlder" }
  | { type: "post" }
  | { type: "confirm" };

export const comparatorOf = (s: Pick<State, "comparator" | "key">) => (s.comparator === "tuple" ? compareDesc(s.key) : timestampOnly(s.key));
const headOf = (rows: readonly Occurrence[], key: OrderKey): Tuple | null => {
  const top = [...rows].sort(compareDesc(key))[0];
  return top ? tupleOf(top, key) : null;
};

export function initial(volume: SurfaceVolume): State {
  const key: OrderKey = "event";
  const { kept, reaped } = reap(occurrencesFor(volume), DEFAULT_RETENTION, SCENE_NOW, key);
  const client = kept.slice(0, FIRST_PAGE);
  const newest = client[0];
  const entryRow = kept[Math.min(ENTRY_DEPTH, kept.length - 1)];
  // The newest fixture row is in flight and never reaped, so the stream is never empty.
  if (!newest || !entryRow) throw new Error("feed fixture produced no occurrences");
  const anchor = tupleOf(entryRow, key);
  return {
    now: SCENE_NOW, n: 0, nextSeq: volume + 1, key, server: kept, client, held: [], atHead: true, flushes: 0,
    connected: true, lastDelivered: tupleOf(newest, key), seam: null, catchup: null,
    entry: anchor, stored: anchor, writes: 0, filter: "all", clusterOn: true, expanded: [],
    retention: DEFAULT_RETENTION, reapedTotal: reaped.length, forfeited: 0, lastPage: null,
    comparator: "tuple", swaps: 0, refetches: 0, pending: null,
  };
}

/** Server side: append, then run the named reaper. Reaped rows leave the client too; an anchor past the horizon forfeits, counted. */
function admit(s: State, rows: readonly Occurrence[], retention = s.retention): State {
  const { kept, reaped } = reap([...rows, ...s.server], retention, s.now, s.key);
  if (reaped.length === 0) return { ...s, server: kept, retention };
  const gone = new Set(reaped.map((o) => o.id));
  const horizon = horizonAt(retention, s.now);
  const stored = forfeitAtHorizon(s.stored, reaped, s.key, horizon);
  const entry = forfeitAtHorizon(s.entry, reaped, s.key, horizon);
  return {
    ...s, server: kept, retention, reapedTotal: s.reapedTotal + reaped.length,
    client: s.client.filter((o) => !gone.has(o.id)), held: s.held.filter((o) => !gone.has(o.id)),
    stored: stored.anchor, entry: entry.anchor, forfeited: s.forfeited + stored.forfeited,
  };
}

/** Client side: the merge door — dedupe by identity, then in place at the head or into the held buffer. */
function deliver(s: State, rows: readonly Occurrence[]): { s: State; dropped: number } {
  const present = new Set([...s.client, ...s.held].map((o) => o.id));
  const fresh = rows.filter((o) => !present.has(o.id));
  const newest = headOf(fresh, s.key);
  const lastDelivered = newest && isNewer(newest, s.lastDelivered) ? newest : s.lastDelivered;
  if (fresh.length === 0) return { s: { ...s, lastDelivered }, dropped: rows.length };
  const next = s.atHead ? { ...s, client: [...fresh, ...s.client], flushes: s.flushes + 1 } : { ...s, held: [...s.held, ...fresh] };
  return { s: { ...next, lastDelivered }, dropped: rows.length - fresh.length };
}

const rekey = (t: Tuple, s: State, key: OrderKey): Tuple => {
  const row = s.server.find((o) => o.seq === t.seq);
  return row ? tupleOf(row, key) : { ts: horizonAt(s.retention, s.now), seq: 0 };
};

export function reduce(s: State, a: Action): State {
  switch (a.type) {
    case "arrive": {
      const rows: Occurrence[] = [];
      let now = s.now;
      let n = s.n;
      for (let i = 0; i < a.count; i++) {
        n += 1;
        if (i === 0 || !a.sync) now += advanceFor(n); // a sync burst is stamped in one second: ties on purpose
        // A late arrival happened halfway between the entry anchor and now: below the head, above the anchor.
        rows.push(arrivalAt(n, s.nextSeq + i, now, { eventAt: a.late ? Math.round((now + s.entry.ts) / 2) : undefined, sync: a.sync }));
      }
      const admitted = admit({ ...s, now, n, nextSeq: s.nextSeq + a.count }, rows);
      return admitted.connected ? deliver(admitted, rows).s : admitted;
    }
    case "key":
      return { ...s, key: a.key, stored: rekey(s.stored, s, a.key), entry: rekey(s.entry, s, a.key), lastDelivered: rekey(s.lastDelivered, s, a.key) };
    case "scroll":
      return s.atHead === a.atHead ? s : { ...s, atHead: a.atHead };
    case "jump":
      return { ...s, atHead: true, client: [...s.held, ...s.client], held: [], flushes: s.held.length ? s.flushes + 1 : s.flushes };
    case "disconnect":
      return { ...s, connected: false, seam: null, catchup: null };
    case "reconnect": {
      if (!a.ok) return { ...s, connected: true, seam: "missed", catchup: null };
      // A cursor walk: newer-than the last delivered tuple — plus the boundary row itself, which a
      // resumed stream commonly replays. Identity at the merge door drops the overlap.
      const gap = s.server.filter((o) => !isNewer(s.lastDelivered, tupleOf(o, s.key)));
      const { s: next, dropped } = deliver({ ...s, connected: true }, gap);
      return { ...next, seam: "clean", catchup: { fetched: gap.length, dropped } };
    }
    case "refetch": {
      const cmp = comparatorOf(s);
      const before = [...s.client].sort(cmp);
      const input = shuffled(s.client, mulberry32(500 + s.refetches));
      return { ...s, client: input, refetches: s.refetches + 1, swaps: swapsBetween(before, [...input].sort(cmp)) };
    }
    case "comparator":
      return { ...s, comparator: a.comparator, swaps: 0 };
    case "markRead": {
      const head = headOf(s.client, s.key);
      if (!head || (head.ts === s.stored.ts && head.seq === s.stored.seq)) return s; // idempotent: no write
      return { ...s, stored: head, writes: s.writes + 1 };
    }
    case "filter":
      return { ...s, filter: a.filter };
    case "cluster":
      return { ...s, clusterOn: a.on };
    case "expand":
      return { ...s, expanded: s.expanded.includes(a.id) ? s.expanded.filter((x) => x !== a.id) : [...s.expanded, a.id] };
    case "horizon":
      return { ...admit(s, [], { ...s.retention, horizonDays: a.days }), lastPage: null };
    case "pageOlder": {
      const oldest = [...s.client].sort(compareDesc(s.key)).at(-1);
      if (!oldest) return s;
      const page = pageOlder(s.server, tupleOf(oldest, s.key), s.key, PAGE);
      const present = new Set(s.client.map((o) => o.id));
      return { ...s, client: [...s.client, ...page.rows.filter((o) => !present.has(o.id))], lastPage: { rows: page.rows.length, truncated: page.truncated } };
    }
    case "post":
      // Optimistic: stamped by the RENDERER's clock and holding no seq — so it stays outside the ranked list.
      return { ...s, pending: { id: "pending-note", seq: -1, kind: "followup", actor: "you", object: "a note", eventAt: s.now, arrivedAt: s.now, settled: false, warn: false } };
    case "confirm": {
      if (!s.pending) return s;
      const now = s.now + advanceFor(s.n + 1);
      const row: Occurrence = { ...s.pending, id: `oc-${s.nextSeq}`, seq: s.nextSeq, eventAt: now, arrivedAt: now, settled: true };
      const admitted = admit({ ...s, now, n: s.n + 1, nextSeq: s.nextSeq + 1, pending: null }, [row]);
      return admitted.connected ? deliver(admitted, [row]).s : admitted;
    }
  }
}
