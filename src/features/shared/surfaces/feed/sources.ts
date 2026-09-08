// Source excerpts for the mechanism drawer — verbatim from the scene's own files (feedOrder.ts,
// feedStore.ts, feedRetention.ts, FeedRegion.tsx, FeedRows.tsx, useFeed.ts). Kept as string constants
// so the drawer needs no build step; when the code moves, these move with it in the same commit.

export const SRC_CHRONOLOGY = `// feedOrder.ts — ONE comparator: the chosen key's timestamp desc, then the authority's seq desc.
// Three-way, so equality falls through to the tiebreaker. Every rank site imports it.
export const compareDesc = (key: OrderKey) => (a: Occurrence, b: Occurrence): number =>
  tsOf(b, key) - tsOf(a, key) || b.seq - a.seq;
// The defective one: ties fall to input iteration order under a stable sort. Demo only.
export const timestampOnly = (key) => (a, b) => tsOf(b, key) - tsOf(a, key);

// feedStore.ts — a refetch re-sorts SHUFFLED delivery order and counts the rows that moved
const before = [...s.client].sort(cmp);
const input = shuffled(s.client, mulberry32(500 + s.refetches));
return { ...s, client: input, swaps: swapsBetween(before, [...input].sort(cmp)) };
// switching the key re-mints the cursor and BOTH anchors from the same occurrence — never one key ordering, another anchoring
case "key": return { ...s, key: a.key, stored: rekey(s.stored, s, a.key), entry: rekey(s.entry, s, a.key), lastDelivered: rekey(…) };
// the optimistic note holds no seq: the renderer's clock never ranks — it waits in a pending strip until the server confirms
case "post": return { ...s, pending: { id: "pending-note", seq: -1, …, eventAt: s.now, settled: false } };`;

export const SRC_PREPEND = `// feedStore.ts — the merge door: identity dedupe, then in place at the head or into the HELD buffer
function deliver(s, rows) {
  const present = new Set([...s.client, ...s.held].map((o) => o.id));
  const fresh = rows.filter((o) => !present.has(o.id));
  const next = s.atHead
    ? { ...s, client: [...fresh, ...s.client], flushes: s.flushes + 1 }   // one commit per batch
    : { ...s, held: [...s.held, ...fresh] };                              // nothing above the viewport changes
  return { s: { ...next, lastDelivered }, dropped: rows.length - fresh.length };
}
// reconnect: a cursor walk newer-than the last delivered tuple; the replayed boundary row is dropped by identity
const gap = s.server.filter((o) => !isNewer(s.lastDelivered, tupleOf(o, s.key)));
if (!a.ok) return { ...s, connected: true, seam: "missed" };             // a failed catch-up is SAID, never a clean resume

// FeedRegion.tsx — the reader's scroll is a declaration; the pill is the held buffer's exact size
onScroll={(e) => dispatch({ type: "scroll", atHead: e.currentTarget.scrollTop <= BAND_PX })}
{s.held.length > 0 ? <button onClick={jump}>{s.held.length} new · jump to latest</button> : null}
// FeedRows.tsx — entrances keyed by identity, first viewport only, settled under reduced
const enters = !reduced && i < ANIMATED_DEPTH && !entered.has(key);
<motion.li key={key} initial={enters ? { opacity: 0, y: -8 } : false} animate={{ opacity: 1, y: 0 }} />`;

export const SRC_CLUSTER = `// feedOrder.ts — a cluster is a VIEW over the atomic rows: consecutive · one relation key · windowed · capped
const relationOf = (o) => (NEVER_CLUSTER.includes(o.kind) || o.kind !== "sync" ? null : \`\${o.actor}:sync\`);
export function clusterRows(sorted, key, opts) {
  if (!opts.on) return sorted.map((o) => ({ type: "row", o }));          // the flat log: same storage, no grouping
  …
  while (j < sorted.length && members.length < opts.cap && relationOf(sorted[j]) === rel
         && tsOf(members[members.length - 1], key) - tsOf(sorted[j], key) <= opts.windowMs) { members.push(sorted[j]); j++; }
  const oldest = members[members.length - 1];
  out.push({ type: "cluster", id: \`\${rel}:\${oldest.seq}\`,             // identity = the OLDEST member: stable as it grows
             members, warn: members.filter((m) => m.warn).length,      // the worst member is shown, never averaged away
             newest: tsOf(head, key), oldest: tsOf(oldest, key) });    // position = the NEWEST member: a live run sorts at now
}
// useFeed.ts — recomputed at every render, stored nowhere
const rows = clusterRows(sorted, s.key, { on: s.clusterOn, windowMs: CLUSTER_WINDOW_MS, cap: CLUSTER_CAP });
// FeedRows.tsx — the row says what it counted: relation · count · span; disclosure keeps the run in place
{c.relation.split(":")[0]} · synced {c.members.length} repos · {span} {c.warn ? \`\${c.warn} warnings\` : null}`;

export const SRC_READ = `// feedStore.ts — the anchor is the ordering tuple; the entry snapshot is frozen at creation
const anchor = tupleOf(kept[Math.min(ENTRY_DEPTH, kept.length - 1)], key);
return { …, entry: anchor, stored: anchor, writes: 0 };
// mark-all-read = anchor-set-to-head, idempotent: an anchor already at the head writes nothing
case "markRead": {
  const head = headOf(s.client, s.key);                                   // held rows were never seen: not the head
  if (!head || (head.ts === s.stored.ts && head.seq === s.stored.seq)) return s;
  return { ...s, stored: head, writes: s.writes + 1 };
}
// useFeed.ts — the count is DERIVED: one comparison per occurrence, under the filter's predicate
const unseen     = all.filter((o) => matches(o) && newerThan(o, s.stored, s.key)).length;  // the badge
const sinceEntry = all.filter((o) => matches(o) && newerThan(o, s.entry,  s.key)).length;  // the delta: never against the store
export const badgeLabel = (n) => (n > BADGE_CAP ? \`\${BADGE_CAP}+\` : String(n));           // cap the display, not the truth`;

export const SRC_RETENTION = `// feedRetention.ts — declared with the feed: age bound × per-actor floor, settings not constants, the reaper NAMED
export const REAPER = "retention.reap-on-insert";
export const DEFAULT_RETENTION = { horizonDays: 30, floorPerActor: 3, archive: "audit log (fiction)" };
export function reap(rows, r, now, key) {
  for (const o of [...rows].sort(compareDesc(key))) {                   // the floor is a total-order cut
    const seen = perActor.get(o.actor) ?? 0; perActor.set(o.actor, seen + 1);
    const eligible = o.settled && tupleOf(o, key).ts < horizon && seen >= r.floorPerActor;   // settled rows only
    (eligible ? reaped : kept).push(o);
  }
}
// a cursor past the horizon → the oldest window PLUS the marker, never an empty page
if (older.length === 0) return { rows: sorted.slice(-size), truncated: true };
// an anchor past the horizon → caught up by forfeit, and the forfeit is COUNTED so the surface can say so
const forfeited = reaped.filter((o) => isNewer(tupleOf(o, key), anchor)).length;
// feedStore.ts — the reaper runs on every insert
function admit(s, rows, retention = s.retention) { const { kept, reaped } = reap([...rows, ...s.server], retention, s.now, s.key); … }
// FeedRegion.tsx — the edge renders as an edge
showing the last {s.retention.horizonDays} days · {retained} retained · older rows: {s.retention.archive}`;
