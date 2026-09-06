// Retention as a declared contract — pure, no React. The feed is created WITH its retention: an age
// bound composed with a per-actor floor, its parameters settings (the region's controls) rather than
// constants, and its reaper NAMED (`REAPER`), invoked on every insert. The reaper reaps only settled
// rows; the floor is a total-order cut (the same comparator as everything else); a cursor past the
// horizon resolves to the oldest window PLUS a truncation marker, never an empty page.

import type { Occurrence } from "./fixtures";
import { compareDesc, isNewer, tupleOf, type OrderKey, type Tuple } from "./feedOrder";

export type Retention = {
  /** Age bound: rows whose ordering timestamp is older than `now − horizonDays` are eligible. */
  horizonDays: number;
  /** Per-entity floor: the newest K rows of every actor survive regardless of age. */
  floorPerActor: number;
  /** The durable record the feed is a window over — named, so "forgotten here" is never "gone". */
  archive: string;
};

export const REAPER = "retention.reap-on-insert";
export const HORIZON_CHOICES = [7, 30, 90] as const;
export const DEFAULT_RETENTION: Retention = { horizonDays: 30, floorPerActor: 3, archive: "audit log (fiction)" };

const DAY = 86_400_000;
export const horizonAt = (r: Retention, now: number): number => now - r.horizonDays * DAY;

/**
 * Run the reaper: keep every unsettled row, every row within the horizon, and each actor's newest
 * `floorPerActor` rows (chosen on the total order, so a tie at the K-th row cannot keep K−1 or K+1).
 */
export function reap(rows: readonly Occurrence[], r: Retention, now: number, key: OrderKey): { kept: Occurrence[]; reaped: Occurrence[] } {
  const horizon = horizonAt(r, now);
  const perActor = new Map<string, number>();
  const kept: Occurrence[] = [];
  const reaped: Occurrence[] = [];
  for (const o of [...rows].sort(compareDesc(key))) {
    const seen = perActor.get(o.actor) ?? 0;
    perActor.set(o.actor, seen + 1);
    const eligible = o.settled && tupleOf(o, key).ts < horizon && seen >= r.floorPerActor;
    (eligible ? reaped : kept).push(o);
  }
  return { kept, reaped };
}

export type Page = { rows: Occurrence[]; truncated: boolean };

/**
 * History paging, older-than `cursor`, on the same tuple the order uses. Fewer than `size` rows means
 * the retained history ends here — `truncated: true` renders as "showing the last N days", never as
 * "no more history". A cursor already past the horizon returns the oldest window plus the marker.
 */
export function pageOlder(kept: readonly Occurrence[], cursor: Tuple, key: OrderKey, size: number): Page {
  const sorted = [...kept].sort(compareDesc(key));
  const older = sorted.filter((o) => isNewer(cursor, tupleOf(o, key)));
  if (older.length === 0) return { rows: sorted.slice(-size), truncated: true };
  return { rows: older.slice(0, size), truncated: older.length <= size };
}

/**
 * The anchor at the horizon: a read-position older than the oldest retained row means unseen events
 * were reaped. The reader is caught-up-by-forfeit at the horizon — and the forfeit is COUNTED so the
 * surface can say so instead of zeroing the badge into "nothing happened".
 */
export function forfeitAtHorizon(anchor: Tuple, reaped: readonly Occurrence[], key: OrderKey, horizonTs: number): { anchor: Tuple; forfeited: number } {
  const forfeited = reaped.filter((o) => isNewer(tupleOf(o, key), anchor)).length;
  if (forfeited === 0 && anchor.ts >= horizonTs) return { anchor, forfeited: 0 };
  return { anchor: anchor.ts < horizonTs ? { ts: horizonTs, seq: 0 } : anchor, forfeited };
}
